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

/// Beneficiary QR cards: random secrets -> commitments -> Merkle tree (only the root goes on-chain).
function beneficiaryTree(n, batch = "") {
  const secrets = Array.from({ length: n }, (_, i) => ethers.id(`qr-card-secret-${batch}${i}`));
  const commitments = secrets.map((s) => ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["bytes32"], [s])));
  const tree = StandardMerkleTree.of(commitments.map((c) => [c]), ["bytes32"]);
  const proofFor = (i) => tree.getProof([commitments[i]]);
  return { tree, root: tree.root, secrets, proofFor };
}

// A real one-leaf beneficiary root for tests that only exercise the invoice side. Each payout needs
// its own batch (a root can back only one payout), so tests call freshRoot() per payout.
let batches = 0;
const freshRoot = () => beneficiaryTree(1, `batch-${batches++}-`).root;
const ROOT = freshRoot();

module.exports = { deployFixture, signInvoice, beneficiaryTree, Category, WINDOW, inr, ROOT, freshRoot };
