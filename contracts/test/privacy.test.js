const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { deployFixture, signInvoice, beneficiaryTree, Category, inr, attest, batch, signDelivery } = require("./fixture");

const deadline = () => Math.floor(Date.now() / 1000) + 30 * 86400;

async function funded() {
  const f = await loadFixture(deployFixture);
  await f.vault.connect(f.donorA).donate(0, Category.Water, inr(50_000), deadline()); // lot 0
  return f;
}

let n = 0;
async function payout(f, root, required = 1) {
  const { inv, sig } = await signInvoice(f.vault, f.vendor, { vendor: f.vendor.address, amount: inr(1_000), invoiceNo: `PRIV-${n++}` });
  return f.vault.connect(f.ngoAdmin).requestPayout(inv, sig, [{ lotId: 0, amount: inr(1_000) }], root, required);
}

describe("Beneficiary privacy — independent card lists, card-signed deliveries", () => {
  it("only a registered field partner can attest a card list, and never for its own NGO", async () => {
    const f = await funded();
    const ben = beneficiaryTree(2, "indep-");
    await expect(f.vault.connect(f.stranger).attestBatch(ben.root, 0, 2)).to.be.revertedWithCustomError(f.vault, "NotFieldPartner");
    await f.vault.connect(f.ngoAdmin).registerFieldPartner(ethers.id("Asha's own partner"));
    await expect(f.vault.connect(f.ngoAdmin).attestBatch(ben.root, 0, 2)).to.be.revertedWithCustomError(f.vault, "NotFieldPartner");
    await expect(f.vault.connect(f.fieldWorker).attestBatch(ben.root, 0, 2))
      .to.emit(f.vault, "BatchAttested").withArgs(ben.root, 0, f.fieldWorker.address, 2);
    await expect(f.vault.connect(f.fieldWorker).attestBatch(ben.root, 0, 2)).to.be.revertedWithCustomError(f.vault, "BadBatch"); // once
  });

  it("an NGO can't pay out against a card list nobody independent vouched for", async () => {
    const f = await funded();
    await expect(payout(f, beneficiaryTree(1, "made-up-").root)).to.be.revertedWithCustomError(f.vault, "BatchNotAttested");
    const forOtherNgo = await attest(f.vault, beneficiaryTree(1, "other-ngo-").root, 1, 1);
    await expect(payout(f, forOtherNgo)).to.be.revertedWithCustomError(f.vault, "BatchNotAttested");
    await expect(payout(f, await batch(f.vault, 0, 2), 3)).to.be.revertedWithCustomError(f.vault, "TooManyDeliveries");
  });

  it("a delivery signature is bound to one payout — it can't be replayed for another", async () => {
    const f = await funded();
    // a careless partner puts the same card in two lists
    const shared = new ethers.Wallet(ethers.id("shared-card"));
    const listA = beneficiaryTree(1, "a-");
    const listB = beneficiaryTree(1, "b-");
    const { StandardMerkleTree } = require("@openzeppelin/merkle-tree");
    const treeA = StandardMerkleTree.of([[shared.address], [listA.wallets[0].address]], ["address"]);
    const treeB = StandardMerkleTree.of([[shared.address], [listB.wallets[0].address]], ["address"]);
    await payout(f, await attest(f.vault, treeA.root, 0, 2)); // payout 0
    await payout(f, await attest(f.vault, treeB.root, 0, 2)); // payout 1

    const sigFor0 = await signDelivery(f.vault, shared, 0);
    await f.vault.confirmDelivery(0, sigFor0, treeA.getProof([shared.address]));
    await expect(f.vault.confirmDelivery(0, sigFor0, treeA.getProof([shared.address]))).to.be.revertedWithCustomError(f.vault, "AlreadyDelivered");
    await expect(f.vault.confirmDelivery(1, sigFor0, treeB.getProof([shared.address]))).to.be.revertedWithCustomError(f.vault, "InvalidProof");
  });

  it("the card's private key never appears on-chain — only a signature", async () => {
    const f = await funded();
    const ben = beneficiaryTree(1, "onchain-");
    await payout(f, await attest(f.vault, ben.root, 0, 1));
    const tx = await f.vault.connect(f.stranger).confirmDelivery(0, await ben.sign(f.vault, 0, 0), ben.proofFor(0));
    const calldata = tx.data.toLowerCase();
    expect(calldata).to.not.include(ben.wallets[0].privateKey.slice(2).toLowerCase());
    expect((await f.vault.payout(0)).deliveries).to.equal(1);
  });

  it("a card outside the attested list can't confirm, whoever submits it", async () => {
    const f = await funded();
    const ben = beneficiaryTree(2, "outsider-");
    await payout(f, await attest(f.vault, ben.root, 0, 2), 2);
    const outsider = ethers.Wallet.createRandom();
    await expect(f.vault.confirmDelivery(0, await signDelivery(f.vault, outsider, 0), ben.proofFor(0))).to.be.revertedWithCustomError(f.vault, "InvalidProof");
  });
});
