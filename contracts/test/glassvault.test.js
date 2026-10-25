const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { deployFixture, signInvoice, beneficiaryTree, Category, WINDOW, inr, ROOT } = require("./fixture");

const FR = { DuplicateInvoice: 0, ForgedSignature: 1, OutOfCategory: 2, OverBudget: 3, AmountMismatch: 4, UnregisteredVendor: 5 };
const deadline = () => Math.floor(Date.now() / 1000) + 30 * 86400;

async function donated() {
  const f = await loadFixture(deployFixture);
  await f.vault.connect(f.donorA).donate(0, Category.Water, inr(50_000), deadline()); // lot 0
  await f.vault.connect(f.donorB).donate(0, Category.Water, inr(30_000), deadline()); // lot 1
  await f.vault.connect(f.donorB).donate(0, Category.Medical, inr(10_000), deadline()); // lot 2
  return f;
}

describe("GlassVault — ① inbound donation", () => {
  it("creates a purpose-tagged lot and escrows the funds", async () => {
    const { vault, dinr, donorA } = await loadFixture(deployFixture);
    await expect(vault.connect(donorA).donate(0, Category.Water, inr(50_000), deadline()))
      .to.emit(vault, "Donated").withArgs(0, 0, donorA.address, Category.Water, inr(50_000), anyUint());
    const lot = await vault.lot(0);
    expect(lot.remaining).to.equal(inr(50_000));
    expect(await dinr.balanceOf(await vault.getAddress())).to.equal(inr(50_000 + 20_000 + 5_000)); // + 2 NGO bonds + 1 vendor stake
  });

  it("rejects donations to unknown NGOs", async () => {
    const { vault, donorA } = await loadFixture(deployFixture);
    await expect(vault.connect(donorA).donate(9, Category.Water, inr(1), deadline())).to.be.revertedWithCustomError(vault, "UnknownNGO");
  });
});

describe("GlassVault — ② escrow + ③ invoice proof (happy path)", () => {
  it("accepts a vendor-signed invoice, charges donor lots, and opens the challenge window", async () => {
    const { vault, vendor, ngoAdmin } = await donated();
    const { inv, sig } = await signInvoice(vault, vendor, { vendor: vendor.address, amount: inr(40_000) });
    const shares = [{ lotId: 0, amount: inr(25_000) }, { lotId: 1, amount: inr(15_000) }];

    await expect(vault.connect(ngoAdmin).requestPayout(inv, sig, shares, ROOT, 1)).to.emit(vault, "PayoutRequested");
    expect((await vault.lot(0)).remaining).to.equal(inr(25_000));
    expect((await vault.lot(1)).remaining).to.equal(inr(15_000));
    const shareRows = await vault.payoutShares(0);
    expect(shareRows.length).to.equal(2); // lot-level attribution: each rupee traced to its donor
  });

  it("cannot release before the challenge window closes, then releases 70%", async () => {
    const { vault, dinr, vendor, ngoAdmin, stranger } = await donated();
    const { inv, sig } = await signInvoice(vault, vendor, { vendor: vendor.address, amount: inr(10_000) });
    await vault.connect(ngoAdmin).requestPayout(inv, sig, [{ lotId: 0, amount: inr(10_000) }], ROOT, 1);

    await expect(vault.connect(stranger).release(0)).to.be.revertedWithCustomError(vault, "WindowOpen");
    await time.increase(WINDOW);
    await vault.connect(stranger).release(0); // anyone can trigger — no admin
    expect(await dinr.balanceOf(vendor.address)).to.equal(inr(1_000_000 - 5_000 + 7_000));
    expect((await vault.payout(0)).status).to.equal(2); // Released
  });

  it("only the NGO admin can request payouts", async () => {
    const { vault, vendor, stranger } = await donated();
    const { inv, sig } = await signInvoice(vault, vendor, { vendor: vendor.address, amount: inr(1) });
    await expect(vault.connect(stranger).requestPayout(inv, sig, [{ lotId: 0, amount: inr(1) }], ROOT, 1))
      .to.be.revertedWithCustomError(vault, "NotNGOAdmin");
  });
});

describe("GlassVault — ④ cryptographic impact verification", () => {
  async function released(required = 3) {
    const f = await donated();
    const ben = beneficiaryTree(5);
    const { inv, sig } = await signInvoice(f.vault, f.vendor, { vendor: f.vendor.address, amount: inr(10_000) });
    await f.vault.connect(f.ngoAdmin).requestPayout(inv, sig, [{ lotId: 0, amount: inr(10_000) }], ben.root, required);
    await time.increase(WINDOW);
    await f.vault.release(0);
    return { ...f, ben };
  }

  it("pays the final 30% once enough beneficiaries prove delivery", async () => {
    const { vault, dinr, vendor, fieldWorker, ben } = await released(3);
    for (let i = 0; i < 3; i++) await vault.connect(fieldWorker).confirmDelivery(0, ben.secrets[i], ben.proofFor(i));
    expect(await dinr.balanceOf(vendor.address)).to.equal(inr(1_000_000 - 5_000 + 10_000));
    expect((await vault.payout(0)).status).to.equal(3); // Completed
  });

  it("rejects a beneficiary not in the Merkle tree", async () => {
    const { vault, ben } = await released();
    await expect(vault.confirmDelivery(0, ethers.id("fake-card"), ben.proofFor(0))).to.be.revertedWithCustomError(vault, "InvalidProof");
  });

  it("rejects the same beneficiary confirming twice (delivery nullifier)", async () => {
    const { vault, ben } = await released();
    await vault.confirmDelivery(0, ben.secrets[1], ben.proofFor(1));
    await expect(vault.confirmDelivery(0, ben.secrets[1], ben.proofFor(1))).to.be.revertedWithCustomError(vault, "AlreadyDelivered");
  });

  it("deliveries confirmed during the window complete the payout at release", async () => {
    const f = await donated();
    const ben = beneficiaryTree(2);
    const { inv, sig } = await signInvoice(f.vault, f.vendor, { vendor: f.vendor.address, amount: inr(1_000) });
    await f.vault.connect(f.ngoAdmin).requestPayout(inv, sig, [{ lotId: 0, amount: inr(1_000) }], ben.root, 2);
    await f.vault.confirmDelivery(0, ben.secrets[0], ben.proofFor(0));
    await f.vault.confirmDelivery(0, ben.secrets[1], ben.proofFor(1));
    await time.increase(WINDOW);
    await expect(f.vault.release(0)).to.emit(f.vault, "ImpactVerified");
  });
});

describe("GlassVault — adversarial: fraud is recorded and auto-freezes", () => {
  it("flags a re-scanned duplicate invoice (different file bytes, same fields)", async () => {
    const { vault, vendor, ngoAdmin } = await donated();
    const a = await signInvoice(vault, vendor, { vendor: vendor.address, amount: inr(5_000), invoiceNo: "INV-77" });
    await vault.connect(ngoAdmin).requestPayout(a.inv, a.sig, [{ lotId: 0, amount: inr(5_000) }], ROOT, 1);

    // same invoice re-scanned and charged to a different donor's lot
    const b = await signInvoice(vault, vendor, { vendor: vendor.address, amount: inr(5_000), invoiceNo: "INV-77", fileHash: ethers.id("rescanned-bytes") });
    await expect(vault.connect(ngoAdmin).requestPayout(b.inv, b.sig, [{ lotId: 1, amount: inr(5_000) }], ROOT, 1))
      .to.emit(vault, "FraudFlagged").withArgs(0, FR.DuplicateInvoice, anyBytes(), anyBytes(), 1);
    expect((await vault.lot(1)).remaining).to.equal(inr(30_000)); // no money moved
  });

  it("flags a forged invoice (signed by someone other than the vendor)", async () => {
    const { vault, vendor, ngoAdmin } = await donated();
    const forged = await signInvoice(vault, ngoAdmin, { vendor: vendor.address, amount: inr(9_999) });
    await expect(vault.connect(ngoAdmin).requestPayout(forged.inv, forged.sig, [{ lotId: 0, amount: inr(9_999) }], ROOT, 1))
      .to.emit(vault, "FraudFlagged").withArgs(0, FR.ForgedSignature, anyBytes(), anyBytes(), 1);
  });

  it("flags a malformed signature as forgery instead of reverting", async () => {
    const { vault, vendor, ngoAdmin } = await donated();
    const { inv } = await signInvoice(vault, vendor, { vendor: vendor.address, amount: inr(1) });
    await expect(vault.connect(ngoAdmin).requestPayout(inv, "0x1234", [{ lotId: 0, amount: inr(1) }], ROOT, 1))
      .to.emit(vault, "FraudFlagged").withArgs(0, FR.ForgedSignature, anyBytes(), anyBytes(), 1);
  });

  it("flags spending a Medical lot on a Water vendor (out of category)", async () => {
    const { vault, vendor, ngoAdmin } = await donated();
    const { inv, sig } = await signInvoice(vault, vendor, { vendor: vendor.address, amount: inr(1_000) });
    await expect(vault.connect(ngoAdmin).requestPayout(inv, sig, [{ lotId: 2, amount: inr(1_000) }], ROOT, 1))
      .to.emit(vault, "FraudFlagged").withArgs(0, FR.OutOfCategory, anyBytes(), anyBytes(), 1);
  });

  it("flags charging more than a lot holds (over budget)", async () => {
    const { vault, vendor, ngoAdmin } = await donated();
    const { inv, sig } = await signInvoice(vault, vendor, { vendor: vendor.address, amount: inr(60_000) });
    await expect(vault.connect(ngoAdmin).requestPayout(inv, sig, [{ lotId: 0, amount: inr(60_000) }], ROOT, 1))
      .to.emit(vault, "FraudFlagged").withArgs(0, FR.OverBudget, anyBytes(), anyBytes(), 1);
  });

  it("flags lot shares that don't add up to the invoice (amount mismatch)", async () => {
    const { vault, vendor, ngoAdmin } = await donated();
    const { inv, sig } = await signInvoice(vault, vendor, { vendor: vendor.address, amount: inr(1_000) });
    await expect(vault.connect(ngoAdmin).requestPayout(inv, sig, [{ lotId: 0, amount: inr(400) }], ROOT, 1))
      .to.emit(vault, "FraudFlagged").withArgs(0, FR.AmountMismatch, anyBytes(), anyBytes(), 1);
  });

  it("flags invoices from unregistered vendors", async () => {
    const { vault, stranger, ngoAdmin } = await donated();
    const { inv, sig } = await signInvoice(vault, stranger, { vendor: stranger.address, amount: inr(1_000) });
    await expect(vault.connect(ngoAdmin).requestPayout(inv, sig, [{ lotId: 0, amount: inr(1_000) }], ROOT, 1))
      .to.emit(vault, "FraudFlagged").withArgs(0, FR.UnregisteredVendor, anyBytes(), anyBytes(), 1);
  });

  it("detects the same invoice reused by a DIFFERENT NGO (global nullifier)", async () => {
    const { vault, vendor, ngoAdmin, rogueNgo, donorA } = await donated();
    await vault.connect(donorA).donate(1, Category.Water, inr(20_000), deadline()); // lot 3 → rogue NGO
    const a = await signInvoice(vault, vendor, { vendor: vendor.address, amount: inr(5_000), invoiceNo: "INV-SHARED" });
    await vault.connect(ngoAdmin).requestPayout(a.inv, a.sig, [{ lotId: 0, amount: inr(5_000) }], ROOT, 1);

    const b = await signInvoice(vault, vendor, { vendor: vendor.address, ngoId: 1, amount: inr(5_000), invoiceNo: "INV-SHARED" });
    await expect(vault.connect(rogueNgo).requestPayout(b.inv, b.sig, [{ lotId: 3, amount: inr(5_000) }], ROOT, 1))
      .to.emit(vault, "FraudFlagged").withArgs(1, FR.DuplicateInvoice, anyBytes(), anyBytes(), 1);
  });

  it("auto-freezes the NGO after 2 flags — no admin involved — and blocks all fund movement", async () => {
    const { vault, vendor, ngoAdmin, donorA } = await donated();
    const good = await signInvoice(vault, vendor, { vendor: vendor.address, amount: inr(5_000), invoiceNo: "INV-1" });
    await vault.connect(ngoAdmin).requestPayout(good.inv, good.sig, [{ lotId: 0, amount: inr(5_000) }], ROOT, 1);

    const dup = await signInvoice(vault, vendor, { vendor: vendor.address, amount: inr(5_000), invoiceNo: "INV-1", fileHash: ethers.id("x") });
    await vault.connect(ngoAdmin).requestPayout(dup.inv, dup.sig, [{ lotId: 1, amount: inr(5_000) }], ROOT, 1);

    const forged = await signInvoice(vault, ngoAdmin, { vendor: vendor.address, amount: inr(8_000), invoiceNo: "INV-2" });
    await expect(vault.connect(ngoAdmin).requestPayout(forged.inv, forged.sig, [{ lotId: 1, amount: inr(8_000) }], ROOT, 1))
      .to.emit(vault, "NGOFrozen").withArgs(0, 2);

    expect((await vault.ngo(0)).frozen).to.equal(true);
    await time.increase(WINDOW);
    await expect(vault.release(0)).to.be.revertedWithCustomError(vault, "NGOIsFrozen");
    await expect(vault.connect(donorA).donate(0, Category.Water, inr(1), deadline())).to.be.revertedWithCustomError(vault, "NGOIsFrozen");
    const next = await signInvoice(vault, vendor, { vendor: vendor.address, amount: inr(1), invoiceNo: "INV-3" });
    await expect(vault.connect(ngoAdmin).requestPayout(next.inv, next.sig, [{ lotId: 0, amount: inr(1) }], ROOT, 1))
      .to.be.revertedWithCustomError(vault, "NGOIsFrozen");
  });
});

// chai matchers for "any value" in withArgs
function anyUint() { return (v) => typeof v === "bigint"; }
function anyBytes() { return (v) => typeof v === "string" && v.startsWith("0x"); }
