const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { deployFixture, signInvoice, Category, WINDOW, inr, batch, beneficiaryTree, attest } = require("./fixture");

const FR = { ImpossibleTimeline: 10, InvoiceBeforeDonation: 11, ImpactNotProven: 12 };
const DAY = 86400;
const anyBytes = () => (v) => typeof v === "string" && v.startsWith("0x");
const deadlineIn = async (days) => (await time.latest()) + days * DAY;

async function funded() {
  const f = await loadFixture(deployFixture);
  await f.vault.connect(f.donorA).donate(0, Category.Water, inr(50_000), await deadlineIn(30)); // lot 0
  return f;
}

describe("Impossible timelines — enforced by the contract", () => {
  it("an invoice dated in the future is a fraud flag (fabricated)", async () => {
    const { vault, vendor, ngoAdmin } = await funded();
    const future = (await time.latest()) + 3 * DAY;
    const { inv, sig } = await signInvoice(vault, vendor, { vendor: vendor.address, amount: inr(1_000), date: future });
    await expect(vault.connect(ngoAdmin).requestPayout(inv, sig, [{ lotId: 0, amount: inr(1_000) }], await batch(vault), 1))
      .to.emit(vault, "FraudFlagged").withArgs(0, FR.ImpossibleTimeline, anyBytes(), anyBytes(), 1);
  });

  it("spending dated well before the donation is a recorded discrepancy; within 7 days it is accepted", async () => {
    const { vault, vendor, ngoAdmin } = await funded();
    const now = await time.latest();
    const old = await signInvoice(vault, vendor, { vendor: vendor.address, amount: inr(1_000), invoiceNo: "OLD", date: now - 10 * DAY });
    await expect(vault.connect(ngoAdmin).requestPayout(old.inv, old.sig, [{ lotId: 0, amount: inr(1_000) }], await batch(vault), 1))
      .to.emit(vault, "Discrepancy").withArgs(0, FR.InvoiceBeforeDonation, anyBytes(), anyBytes())
      .and.not.to.emit(vault, "FraudFlagged");
    const recent = await signInvoice(vault, vendor, { vendor: vendor.address, amount: inr(1_000), invoiceNo: "RECENT", date: now - 5 * DAY });
    await expect(vault.connect(ngoAdmin).requestPayout(recent.inv, recent.sig, [{ lotId: 0, amount: inr(1_000) }], await batch(vault), 1))
      .to.emit(vault, "PayoutRequested");
  });
});

describe("Impact timeout — the final 30% can't sit in escrow forever", () => {
  it("after the impact deadline anyone returns the unproven 30% to the donors", async () => {
    const { vault, vendor, ngoAdmin, stranger } = await funded();
    const ben = beneficiaryTree(2, "never-delivered-");
    const { inv, sig } = await signInvoice(vault, vendor, { vendor: vendor.address, amount: inr(10_000) });
    await vault.connect(ngoAdmin).requestPayout(inv, sig, [{ lotId: 0, amount: inr(10_000) }], await attest(vault, ben.root, 0, 2), 2);
    await time.increase(WINDOW);
    await vault.release(0);
    await expect(vault.connect(stranger).expireImpact(0)).to.be.revertedWithCustomError(vault, "ImpactOpen");

    await time.increase(4 * WINDOW + 1);
    const before = (await vault.lot(0)).remaining;
    await expect(vault.connect(stranger).expireImpact(0))
      .to.emit(vault, "ImpactExpired").withArgs(0, inr(3_000))
      .and.to.emit(vault, "Discrepancy").withArgs(0, FR.ImpactNotProven, anyBytes(), anyBytes());
    expect((await vault.lot(0)).remaining - before).to.equal(inr(3_000));
    expect((await vault.payout(0)).status).to.equal(5); // Cancelled
    const org = await vault.ngo(0);
    expect(org.payoutsCompleted).to.equal(0);
    expect(org.flagCount).to.equal(0); // not fraud — but it never counts as delivered impact
  });

  it("a payout whose impact was proven can't be expired", async () => {
    const { vault, vendor, ngoAdmin } = await funded();
    const ben = beneficiaryTree(1, "delivered-");
    const { inv, sig } = await signInvoice(vault, vendor, { vendor: vendor.address, amount: inr(1_000) });
    await vault.connect(ngoAdmin).requestPayout(inv, sig, [{ lotId: 0, amount: inr(1_000) }], await attest(vault, ben.root, 0, 1), 1);
    await vault.confirmDelivery(0, await ben.sign(vault, 0, 0), ben.proofFor(0));
    await time.increase(WINDOW);
    await vault.release(0); // completes immediately
    await time.increase(5 * WINDOW);
    await expect(vault.expireImpact(0)).to.be.revertedWithCustomError(vault, "BadPayout");
  });
});

describe("Dead-man switch — refund or redirect, never stuck", () => {
  it("unspent money moves to the donor's fallback NGO after the deadline, keeping donor and purpose", async () => {
    const { vault, donorB, stranger } = await loadFixture(deployFixture);
    await expect(vault.connect(donorB).donateWithFallback(0, Category.Medical, inr(8_000), await deadlineIn(10), 0)).to.be.revertedWithCustomError(vault, "BadFallback");
    await expect(vault.connect(donorB).donateWithFallback(0, Category.Medical, inr(8_000), await deadlineIn(10), 1))
      .to.emit(vault, "FallbackSet").withArgs(0, 1);
    await expect(vault.connect(stranger).redirect(0)).to.be.revertedWithCustomError(vault, "NotRedirectable");

    await time.increase(11 * DAY);
    await expect(vault.connect(stranger).redirect(0)) // anyone can pull the switch
      .to.emit(vault, "LotRedirected").withArgs(0, 1, 1, inr(8_000))
      .and.to.emit(vault, "Donated");
    const moved = await vault.lot(1);
    expect(moved.donor).to.equal(donorB.address);
    expect(moved.ngoId).to.equal(1);
    expect(moved.category).to.equal(Category.Medical);
    expect(moved.amount).to.equal(inr(8_000));
    expect(moved.deadline).to.be.greaterThan(BigInt(await time.latest()));
    expect((await vault.lot(0)).remaining).to.equal(0);
    await expect(vault.connect(donorB).reclaim(0)).to.be.revertedWithCustomError(vault, "ZeroAmount"); // nothing counted twice
  });

  it("a frozen NGO's lot can be redirected right away; without a fallback the donor reclaims", async () => {
    const { vault, vendor, ngoAdmin, donorA, donorB } = await loadFixture(deployFixture);
    await vault.connect(donorA).donateWithFallback(0, Category.Water, inr(5_000), await deadlineIn(30), 1); // lot 0
    await vault.connect(donorB).donate(0, Category.Water, inr(5_000), await deadlineIn(30)); // lot 1, no fallback
    for (const n of ["F-1", "F-2"]) {
      const forged = await signInvoice(vault, ngoAdmin, { vendor: vendor.address, amount: inr(100), invoiceNo: n });
      await vault.connect(ngoAdmin).requestPayout(forged.inv, forged.sig, [{ lotId: 0, amount: inr(100) }], await batch(vault), 1);
    }
    expect((await vault.ngo(0)).frozen).to.equal(true);
    await expect(vault.redirect(0)).to.emit(vault, "LotRedirected");
    await expect(vault.redirect(1)).to.be.revertedWithCustomError(vault, "NotRedirectable");
    await expect(vault.connect(donorB).reclaim(1)).to.emit(vault, "Reclaimed");
  });
});
