import { ethers } from "ethers";

export const CATEGORIES = ["Water", "Medical", "Education"];
export const CAT = { Water: 0, Medical: 1, Education: 2 };

// Local Hardhat chains use the public dev mnemonic, so the role switcher can sign as any demo
// participant without MetaMask. Every action is still a real signed transaction on-chain.
const DEV_MNEMONIC = "test test test test test test test test test test test junk";
export const devKey = (index) => ethers.HDNodeWallet.fromPhrase(DEV_MNEMONIC, undefined, `m/44'/60'/0'/0/${index}`).privateKey;

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

export function makeChain(config) {
  const providerA = new ethers.JsonRpcProvider(config.rpcA, undefined, { staticNetwork: true, pollingInterval: 1000 });
  const providerB = new ethers.JsonRpcProvider(config.rpcB, undefined, { staticNetwork: true, pollingInterval: 1000 });
  const A = config.chainA;
  const B = config.chainB;

  const signers = new Map();
  /// Plain wallet per (role, chain): it asks the chain for the pending nonce on every send, so a
  /// reverted estimate or the backend using the same key can never leave it stuck on a stale nonce.
  /// Rapid clicks are serialized per role by `tx()` in the store.
  function devSigner(role, chain = "A") {
    const key = `${role}:${chain}`;
    if (!signers.has(key)) signers.set(key, new ethers.Wallet(devKey(config.roles[role].index), chain === "A" ? providerA : providerB));
    return signers.get(key);
  }

  const contracts = (signer, signerB) => ({
    vault: new ethers.Contract(A.GlassVault.address, A.GlassVault.abi, signer ?? providerA),
    dinr: new ethers.Contract(A.DINR.address, A.DINR.abi, signer ?? providerA),
    impact: new ethers.Contract(A.ProofOfImpact.address, A.ProofOfImpact.abi, providerA),
    dinrB: new ethers.Contract(B.DINR.address, B.DINR.abi, signerB ?? providerB),
    gatewayB: new ethers.Contract(B.BridgeGateway.address, B.BridgeGateway.abi, signerB ?? providerB),
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
  const invoiceNullifier = (f) =>
    ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["address", "bytes32", "uint64", "uint256"], [f.vendor, ethers.id(f.invoiceNo), f.date, toWei(f.amount)]));

  return { providerA, providerB, devSigner, contracts, signInvoice, recoverInvoiceSigner, typedInvoice, invoiceNullifier, A, B };
}

/// Turns a revert into a readable reason using the contract's custom errors.
export function reason(e) {
  return e?.revert?.name ?? e?.info?.error?.message?.replace(/^.*reverted with custom error '([^']+)'.*$/, "$1") ?? e?.shortMessage ?? e?.message ?? "Transaction failed";
}

export const short = (a = "", n = 4) => (a.length > 2 * n + 2 ? `${a.slice(0, n + 2)}…${a.slice(-n)}` : a);
