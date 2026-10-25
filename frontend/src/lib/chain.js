import { ethers } from "ethers";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";

export const CATEGORIES = ["Water", "Medical", "Education"];
export const CAT = { Water: 0, Medical: 1, Education: 2 };

export const ROLE_META = {
  donorPriya: { label: "Priya", kind: "Donor" },
  donorRahul: { label: "Rahul", kind: "Donor" },
  donorCSR: { label: "Tata CSR", kind: "Donor" },
  ngoAsha: { label: "Asha Foundation", kind: "NGO" },
  ngoShadow: { label: "Shadow Trust", kind: "NGO" },
  vendorWater: { label: "BlueWell Pumps", kind: "Vendor" },
  vendorMedical: { label: "MediCare Supplies", kind: "Vendor" },
  vendorEducation: { label: "Vidya Books", kind: "Vendor" },
  vendorShell: { label: "QuickFix Traders", kind: "Vendor" },
  fieldWorker: { label: "Field worker", kind: "Field" },
  watcher: { label: "Watcher", kind: "Watcher" },
};

export const toWei = (n) => ethers.parseUnits(String(n), 18);
export const fromWei = (v) => Number(ethers.formatUnits(v, 18));

// How often tx.wait() polls for the receipt. Local chains mine instantly, so 1s polling made every
// action feel 1s slow; public testnets should raise this (config.pollingMs) to respect RPC limits.
const POLL_MS = 200;

export function makeChain(config) {
  // cacheTimeout -1: ethers caches identical RPC calls for 250ms by default, which hands a second
  // transaction sent right after a confirmation the SAME pending nonce ("nonce too low").
  const poll = { staticNetwork: true, pollingInterval: config.pollingMs ?? POLL_MS, cacheTimeout: -1 };
  const providerA = new ethers.JsonRpcProvider(config.rpcA, undefined, poll);
  const providerB = new ethers.JsonRpcProvider(config.rpcB, undefined, poll);
  const A = config.chainA;
  const B = config.chainB;

  const contracts = (signer, signerB) => ({
    vault: new ethers.Contract(A.GlassVault.address, A.GlassVault.abi, signer ?? providerA),
    dinr: new ethers.Contract(A.DINR.address, A.DINR.abi, signer ?? providerA),
    impact: new ethers.Contract(A.ProofOfImpact.address, A.ProofOfImpact.abi, providerA),
    dinrB: new ethers.Contract(B.DINR.address, B.DINR.abi, signerB ?? providerB),
    gatewayB: new ethers.Contract(B.BridgeGateway.address, B.BridgeGateway.abi, signerB ?? providerB),
    // ETH → dINR exchange the bridge swaps through (null on deployments that predate it)
    dexB: B.MockDEX ? new ethers.Contract(B.MockDEX.address, B.MockDEX.abi, signerB ?? providerB) : null,
    dex: A.MockDEX ? new ethers.Contract(A.MockDEX.address, A.MockDEX.abi, signer ?? providerA) : null,
  });

  const domain = { name: "GlassVault", version: "1", chainId: A.chainId, verifyingContract: A.GlassVault.address };
  const invoiceTypes = {
    Invoice: [
      { name: "vendor", type: "address" },
      { name: "ngoId", type: "uint256" },
      { name: "invoiceNo", type: "bytes32" },
      { name: "amount", type: "uint256" },
      { name: "date", type: "uint64" },
      { name: "category", type: "uint8" },
      { name: "fileHash", type: "bytes32" },
    ],
  };

  /// Typed invoice exactly as the contract hashes it.
  const typedInvoice = (f) => ({
    vendor: f.vendor,
    ngoId: BigInt(f.ngoId),
    invoiceNo: ethers.id(f.invoiceNo),
    amount: toWei(f.amount),
    date: BigInt(f.date),
    category: Number(f.category),
    fileHash: f.fileHash,
  });

  const signInvoice = (signer, f) => signer.signTypedData(domain, invoiceTypes, typedInvoice(f));
  const recoverInvoiceSigner = (f, sig) => {
    try {
      return ethers.verifyTypedData(domain, invoiceTypes, typedInvoice(f), sig);
    } catch {
      return null;
    }
  };
  // ── fiat off-ramp settlement (EIP-712) ──
  // The struct layout is read from the deployed vault ABI (attestFiat's first argument), so the signed
  // fields always match what the contract hashes. Bank reference and payee are normalised, then hashed:
  // only hashes go on-chain, and "utr123 " can't dodge the nullifier on "UTR123".
  const fiatFn = (() => {
    try {
      return new ethers.Interface(A.GlassVault.abi).getFunction("attestFiat");
    } catch {
      return null;
    }
  })();
  const fiatStruct = fiatFn?.inputs[0];
  const fiatTypeName = fiatStruct?.internalType?.split(".").pop()?.replace(/^struct /, "") || "FiatSettlement";
  const fiatTypes = {
    [fiatTypeName]: fiatStruct?.components?.map((c) => ({ name: c.name, type: c.type })) ?? [
      { name: "payoutId", type: "uint256" },
      { name: "fiatAmount", type: "uint256" },
      { name: "bankRefHash", type: "bytes32" },
      { name: "payeeHash", type: "bytes32" },
      { name: "paidAt", type: "uint64" },
    ],
  };
  const bankRefHash = (ref) => ethers.id(String(ref).trim().toUpperCase().replace(/\s+/g, ""));
  const payeeHash = (payee) => ethers.id(String(payee).trim().toLowerCase().replace(/\s+/g, " "));
  /// { payoutId, fiatAmount (₹), bankRef, payee, paidAt (unix s), agent? } → struct exactly as attestFiat takes it
  const typedFiat = (f) => {
    const known = { payoutId: BigInt(f.payoutId), fiatAmount: toWei(f.fiatAmount), bankRefHash: bankRefHash(f.bankRef), payeeHash: payeeHash(f.payee), paidAt: BigInt(f.paidAt) };
    return Object.fromEntries(fiatTypes[fiatTypeName].map(({ name }) => [name, name in known ? known[name] : f.agent]));
  };
  const signFiatSettlement = async (signer, f) => {
    const value = typedFiat(f);
    return { value, signature: await signer.signTypedData(domain, fiatTypes, value) };
  };
  const supportsFiat = !!fiatFn;

  const invoiceNullifier = (f) =>
    ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["address", "bytes32", "uint64", "uint256"], [f.vendor, ethers.id(f.invoiceNo), f.date, toWei(f.amount)]));

  // ── beneficiary cards: each card is a key pair; its QR holds the private key, the list holds addresses ──
  const deliveryTypes = { Delivery: [{ name: "payoutId", type: "uint256" }] };
  /// A card signs "I received payout #id". The key never goes on-chain — only this signature does,
  /// so a used card can't be replayed for another payout or copied from the mempool.
  const signDelivery = (cardWallet, payoutId) => cardWallet.signTypedData(domain, deliveryTypes, { payoutId: BigInt(payoutId) });

  return { providerA, providerB, contracts, signInvoice, recoverInvoiceSigner, typedInvoice, invoiceNullifier, signFiatSettlement, typedFiat, supportsFiat, signDelivery, deliveryTypes, A, B };
}

/// Builds a beneficiary batch in the browser: n fresh card keys and the Merkle tree of their addresses.
/// Only `dump` (addresses) and `root` ever leave the browser; the keys are printed on the cards.
export function cardBatch(n) {
  const wallets = Array.from({ length: n }, () => ethers.Wallet.createRandom());
  const tree = StandardMerkleTree.of(wallets.map((w) => [w.address]), ["address"]);
  return { wallets, tree, root: tree.root, dump: tree.dump() };
}

/// Card key from a scanned/pasted QR → in-memory wallet, or null if it isn't a valid key.
export function cardFromKey(text) {
  try {
    return new ethers.Wallet(String(text).trim());
  } catch {
    return null;
  }
}

/// Turns a revert into a readable reason using the contract's custom errors.
export function reason(e) {
  return e?.revert?.name ?? e?.info?.error?.message?.replace(/^.*reverted with custom error '([^']+)'.*$/, "$1") ?? e?.shortMessage ?? e?.message ?? "Transaction failed";
}

export const short = (a = "", n = 4) => (a.length > 2 * n + 2 ? `${a.slice(0, n + 2)}…${a.slice(-n)}` : a);
