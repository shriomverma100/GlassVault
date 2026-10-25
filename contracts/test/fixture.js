const { ethers } = require("hardhat");
const { StandardMerkleTree } = require("@openzeppelin/merkle-tree");

const Category = { Water: 0, Medical: 1, Education: 2 };
const WINDOW = 60;
const inr = (n) => ethers.parseUnits(String(n), 18);

async function deployFixture() {
  const [deployer, donorA, donorB, ngoAdmin, vendor, rogueNgo, fieldWorker, stranger] = await ethers.getSigners();

  const dinr = await ethers.deployContract("DINR");
  const gateway = await ethers.deployContract("BridgeGateway", [await dinr.getAddress(), deployer.address]);
  const vault = await ethers.deployContract("GlassVault", [await dinr.getAddress(), WINDOW, await gateway.getAddress()]);
  await dinr.mint(await gateway.getAddress(), inr(100_000)); // destination-side bridge liquidity
  await gateway.setVault(await vault.getAddress());

  // everyone needs dINR: donors donate, NGOs bond, vendors stake, watchers bond challenges
  for (const s of [donorA, donorB, ngoAdmin, vendor, rogueNgo, fieldWorker, stranger]) {
    await dinr.mint(s.address, inr(1_000_000));
    await dinr.connect(s).approve(await vault.getAddress(), ethers.MaxUint256);
  }

  await vault.connect(ngoAdmin).registerNGO("Asha Foundation");
  await vault.connect(rogueNgo).registerNGO("Shadow Trust");
  await vault.connect(vendor).registerVendor(Category.Water, ethers.id("GSTIN-27AAPFU0939F1ZV"));
  await vault.connect(fieldWorker).registerFieldPartner(ethers.id("Sahyog Field Partners")); // independent of every NGO

  return { dinr, vault, gateway, deployer, donorA, donorB, ngoAdmin, vendor, rogueNgo, fieldWorker, stranger };
}

/// Builds an invoice and has `signer` sign it with EIP-712.
async function signInvoice(vault, signer, fields) {
  const inv = {
    vendor: fields.vendor,
    ngoId: fields.ngoId ?? 0,
    invoiceNo: ethers.id(fields.invoiceNo ?? "INV-001"),
    amount: fields.amount,
    date: fields.date ?? 1_729_000_000,
    category: fields.category ?? Category.Water,
    fileHash: fields.fileHash ?? ethers.id("file-bytes-original"),
  };
  const { chainId } = await ethers.provider.getNetwork();
  const domain = { name: "GlassVault", version: "1", chainId, verifyingContract: await vault.getAddress() };
  const types = {
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
  const sig = await signer.signTypedData(domain, types, inv);
  return { inv, sig };
}

/// Card signs "delivered for payout #id" (EIP-712 Delivery) — the key never goes on-chain.
async function signDelivery(vault, card, payoutId) {
  const { chainId } = await ethers.provider.getNetwork();
  const domain = { name: "GlassVault", version: "1", chainId, verifyingContract: await vault.getAddress() };
  return card.signTypedData(domain, { Delivery: [{ name: "payoutId", type: "uint256" }] }, { payoutId });
}

/// Beneficiary QR cards: each card is a key pair; only a Merkle root of card ADDRESSES goes on-chain.
function beneficiaryTree(n, batch = "") {
  const wallets = Array.from({ length: n }, (_, i) => new ethers.Wallet(ethers.id(`qr-card-${batch}${i}`)));
  const tree = StandardMerkleTree.of(wallets.map((w) => [w.address]), ["address"]);
  const proofFor = (i) => tree.getProof([wallets[i].address]);
  const sign = (vault, payoutId, i) => signDelivery(vault, wallets[i], payoutId);
  return { tree, root: tree.root, wallets, proofFor, sign };
}

// Each payout needs its own card list (a root can back only one payout), attested by the field partner.
let batches = 0;
const freshRoot = () => beneficiaryTree(1, `batch-${batches++}-`).root;
const ROOT = freshRoot();

/// The fixture's field partner (signer #6) attests `root` for an NGO; returns the root.
async function attest(vault, root, ngoId = 0, cards = 1) {
  const fieldWorker = (await ethers.getSigners())[6];
  await vault.connect(fieldWorker).attestBatch(root, ngoId, cards);
  return root;
}
/// A fresh attested card list for one payout.
const batch = (vault, ngoId = 0, cards = 1) => attest(vault, freshRoot(), ngoId, Math.max(1, cards));

module.exports = { deployFixture, signInvoice, beneficiaryTree, Category, WINDOW, inr, ROOT, freshRoot, batch, attest, signDelivery };
