const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { deployFixture, signInvoice, beneficiaryTree, Category, WINDOW, inr, ROOT, freshRoot } = require("./fixture");

const FR = { DuplicateInvoice: 0, ForgedSignature: 1, OutOfCategory: 2, OverBudget: 3, AmountMismatch: 4, UnregisteredVendor: 5, ChallengeUpheld: 6, VendorDoubleSign: 7 };
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

    await expect(vault.connect(ngoAdmin).requestPayout(inv, sig, shares, freshRoot(), 1)).to.emit(vault, "PayoutRequested");
    expect((await vault.lot(0)).remaining).to.equal(inr(25_000));
    expect((await vault.lot(1)).remaining).to.equal(inr(15_000));
    const shareRows = await vault.payoutShares(0);
    expect(shareRows.length).to.equal(2); // lot-level attribution: each rupee traced to its donor
  });

  it("cannot release before the challenge window closes, then releases 70%", async () => {
    const { vault, dinr, vendor, ngoAdmin, stranger } = await donated();
    const { inv, sig } = await signInvoice(vault, vendor, { vendor: vendor.address, amount: inr(10_000) });
    await vault.connect(ngoAdmin).requestPayout(inv, sig, [{ lotId: 0, amount: inr(10_000) }], freshRoot(), 1);

    await expect(vault.connect(stranger).release(0)).to.be.revertedWithCustomError(vault, "WindowOpen");
    await time.increase(WINDOW);
    await vault.connect(stranger).release(0); // anyone can trigger — no admin
    expect(await dinr.balanceOf(vendor.address)).to.equal(inr(1_000_000 - 5_000 + 7_000));
    expect((await vault.payout(0)).status).to.equal(2); // Released
  });

  it("only the NGO admin can request payouts", async () => {
    const { vault, vendor, stranger } = await donated();
    const { inv, sig } = await signInvoice(vault, vendor, { vendor: vendor.address, amount: inr(1) });
    await expect(vault.connect(stranger).requestPayout(inv, sig, [{ lotId: 0, amount: inr(1) }], freshRoot(), 1))
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
    await vault.connect(ngoAdmin).requestPayout(a.inv, a.sig, [{ lotId: 0, amount: inr(5_000) }], freshRoot(), 1);

    // same invoice re-scanned and charged to a different donor's lot
    const b = await signInvoice(vault, vendor, { vendor: vendor.address, amount: inr(5_000), invoiceNo: "INV-77", fileHash: ethers.id("rescanned-bytes") });
    await expect(vault.connect(ngoAdmin).requestPayout(b.inv, b.sig, [{ lotId: 1, amount: inr(5_000) }], freshRoot(), 1))
      .to.emit(vault, "FraudFlagged").withArgs(0, FR.DuplicateInvoice, anyBytes(), anyBytes(), 1);
    expect((await vault.lot(1)).remaining).to.equal(inr(30_000)); // no money moved
  });

  it("flags a forged invoice (signed by someone other than the vendor)", async () => {
    const { vault, vendor, ngoAdmin } = await donated();
    const forged = await signInvoice(vault, ngoAdmin, { vendor: vendor.address, amount: inr(9_999) });
    await expect(vault.connect(ngoAdmin).requestPayout(forged.inv, forged.sig, [{ lotId: 0, amount: inr(9_999) }], freshRoot(), 1))
      .to.emit(vault, "FraudFlagged").withArgs(0, FR.ForgedSignature, anyBytes(), anyBytes(), 1);
  });

  it("flags a malformed signature as forgery instead of reverting", async () => {
    const { vault, vendor, ngoAdmin } = await donated();
    const { inv } = await signInvoice(vault, vendor, { vendor: vendor.address, amount: inr(1) });
    await expect(vault.connect(ngoAdmin).requestPayout(inv, "0x1234", [{ lotId: 0, amount: inr(1) }], freshRoot(), 1))
      .to.emit(vault, "FraudFlagged").withArgs(0, FR.ForgedSignature, anyBytes(), anyBytes(), 1);
  });

  it("flags spending a Medical lot on a Water vendor (out of category)", async () => {
    const { vault, vendor, ngoAdmin } = await donated();
    const { inv, sig } = await signInvoice(vault, vendor, { vendor: vendor.address, amount: inr(1_000) });
    await expect(vault.connect(ngoAdmin).requestPayout(inv, sig, [{ lotId: 2, amount: inr(1_000) }], freshRoot(), 1))
      .to.emit(vault, "FraudFlagged").withArgs(0, FR.OutOfCategory, anyBytes(), anyBytes(), 1);
  });

  it("records charging more than a lot holds as a discrepancy (over budget), not a fraud flag", async () => {
    const { vault, vendor, ngoAdmin } = await donated();
    const { inv, sig } = await signInvoice(vault, vendor, { vendor: vendor.address, amount: inr(60_000) });
    await expect(vault.connect(ngoAdmin).requestPayout(inv, sig, [{ lotId: 0, amount: inr(60_000) }], freshRoot(), 1))
      .to.emit(vault, "Discrepancy").withArgs(0, FR.OverBudget, anyBytes(), anyBytes())
      .and.not.to.emit(vault, "FraudFlagged");
    expect((await vault.lot(0)).remaining).to.equal(inr(50_000));
  });

  it("records lot shares that don't add up to the invoice as a discrepancy (amount mismatch)", async () => {
    const { vault, vendor, ngoAdmin } = await donated();
    const { inv, sig } = await signInvoice(vault, vendor, { vendor: vendor.address, amount: inr(1_000) });
    await expect(vault.connect(ngoAdmin).requestPayout(inv, sig, [{ lotId: 0, amount: inr(400) }], freshRoot(), 1))
      .to.emit(vault, "Discrepancy").withArgs(0, FR.AmountMismatch, anyBytes(), anyBytes());
  });

  it("an honest NGO working from stale balances is never frozen by discrepancies", async () => {
    const { vault, vendor, ngoAdmin } = await donated();
    for (const n of ["S-1", "S-2", "S-3"]) {
      const { inv, sig } = await signInvoice(vault, vendor, { vendor: vendor.address, amount: inr(60_000), invoiceNo: n });
      await vault.connect(ngoAdmin).requestPayout(inv, sig, [{ lotId: 0, amount: inr(60_000) }], freshRoot(), 1);
    }
    const org = await vault.ngo(0);
    expect(org.flagCount).to.equal(0);
    expect(org.frozen).to.equal(false);
  });

  it("flags invoices from unregistered vendors", async () => {
    const { vault, stranger, ngoAdmin } = await donated();
    const { inv, sig } = await signInvoice(vault, stranger, { vendor: stranger.address, amount: inr(1_000) });
    await expect(vault.connect(ngoAdmin).requestPayout(inv, sig, [{ lotId: 0, amount: inr(1_000) }], freshRoot(), 1))
      .to.emit(vault, "FraudFlagged").withArgs(0, FR.UnregisteredVendor, anyBytes(), anyBytes(), 1);
  });

  it("detects a DIFFERENT NGO copying another NGO's invoice (global nullifier)", async () => {
    const { vault, vendor, ngoAdmin, rogueNgo, donorA } = await donated();
    await vault.connect(donorA).donate(1, Category.Water, inr(20_000), deadline()); // lot 3 → rogue NGO
    const a = await signInvoice(vault, vendor, { vendor: vendor.address, amount: inr(5_000), invoiceNo: "INV-SHARED" });
    await vault.connect(ngoAdmin).requestPayout(a.inv, a.sig, [{ lotId: 0, amount: inr(5_000) }], freshRoot(), 1);

    // rogue NGO re-addresses the copied invoice to itself; the vendor never signed that
    const copy = { ...a.inv, ngoId: 1 };
    await expect(vault.connect(rogueNgo).requestPayout(copy, a.sig, [{ lotId: 3, amount: inr(5_000) }], freshRoot(), 1))
      .to.emit(vault, "FraudFlagged").withArgs(1, FR.DuplicateInvoice, anyBytes(), anyBytes(), 1);
  });

  it("a vendor that signs the same invoice for two NGOs is slashed and banned — the NGO is not blamed", async () => {
    const { vault, vendor, ngoAdmin, rogueNgo, donorA } = await donated();
    await vault.connect(donorA).donate(1, Category.Water, inr(20_000), deadline()); // lot 3 → NGO 1
    // vendor sells the same invoice to NGO 1 first, then to honest NGO 0
    const b = await signInvoice(vault, vendor, { vendor: vendor.address, ngoId: 1, amount: inr(5_000), invoiceNo: "INV-SOLD-TWICE" });
    await vault.connect(rogueNgo).requestPayout(b.inv, b.sig, [{ lotId: 3, amount: inr(5_000) }], freshRoot(), 1);
    const a = await signInvoice(vault, vendor, { vendor: vendor.address, ngoId: 0, amount: inr(5_000), invoiceNo: "INV-SOLD-TWICE" });
    const bondBefore = (await vault.ngo(0)).bond;
    await expect(vault.connect(ngoAdmin).requestPayout(a.inv, a.sig, [{ lotId: 0, amount: inr(5_000) }], freshRoot(), 1))
      .to.emit(vault, "VendorSlashed").withArgs(vendor.address, inr(5_000), anyBytes())
      .and.not.to.emit(vault, "FraudFlagged");

    const org = await vault.ngo(0);
    expect(org.flagCount).to.equal(0);
    expect(org.bond - bondBefore).to.equal(inr(5_000)); // slashed stake stays escrowed in the honest NGO's bond
    const v = await vault.vendors(vendor.address);
    expect(v.registered).to.equal(false);
    expect(v.slashed).to.equal(true);
    await expect(vault.connect(vendor).registerVendor(Category.Medical, ethers.id("new-name")))
      .to.be.revertedWithCustomError(vault, "VendorBanned");
  });

  it("one beneficiary batch can back only one payout", async () => {
    const { vault, vendor, ngoAdmin } = await donated();
    const root = freshRoot();
    const a = await signInvoice(vault, vendor, { vendor: vendor.address, amount: inr(1_000), invoiceNo: "B-1" });
    await vault.connect(ngoAdmin).requestPayout(a.inv, a.sig, [{ lotId: 0, amount: inr(1_000) }], root, 1);
    const b = await signInvoice(vault, vendor, { vendor: vendor.address, amount: inr(1_000), invoiceNo: "B-2" });
    await expect(vault.connect(ngoAdmin).requestPayout(b.inv, b.sig, [{ lotId: 0, amount: inr(1_000) }], root, 1))
      .to.be.revertedWithCustomError(vault, "RootAlreadyUsed");
  });

  it("auto-freezes the NGO after 2 flags — no admin involved — and blocks all fund movement", async () => {
    const { vault, vendor, ngoAdmin, donorA } = await donated();
    const good = await signInvoice(vault, vendor, { vendor: vendor.address, amount: inr(5_000), invoiceNo: "INV-1" });
    await vault.connect(ngoAdmin).requestPayout(good.inv, good.sig, [{ lotId: 0, amount: inr(5_000) }], freshRoot(), 1);

    const dup = await signInvoice(vault, vendor, { vendor: vendor.address, amount: inr(5_000), invoiceNo: "INV-1", fileHash: ethers.id("x") });
    await vault.connect(ngoAdmin).requestPayout(dup.inv, dup.sig, [{ lotId: 1, amount: inr(5_000) }], freshRoot(), 1);

    const forged = await signInvoice(vault, ngoAdmin, { vendor: vendor.address, amount: inr(8_000), invoiceNo: "INV-2" });
    await expect(vault.connect(ngoAdmin).requestPayout(forged.inv, forged.sig, [{ lotId: 1, amount: inr(8_000) }], freshRoot(), 1))
      .to.emit(vault, "NGOFrozen").withArgs(0, 2);

    expect((await vault.ngo(0)).frozen).to.equal(true);
    await time.increase(WINDOW);
    await expect(vault.release(0)).to.be.revertedWithCustomError(vault, "NGOIsFrozen");
    await expect(vault.connect(donorA).donate(0, Category.Water, inr(1), deadline())).to.be.revertedWithCustomError(vault, "NGOIsFrozen");
    const next = await signInvoice(vault, vendor, { vendor: vendor.address, amount: inr(1), invoiceNo: "INV-3" });
    await expect(vault.connect(ngoAdmin).requestPayout(next.inv, next.sig, [{ lotId: 0, amount: inr(1) }], freshRoot(), 1))
      .to.be.revertedWithCustomError(vault, "NGOIsFrozen");
  });
});

// chai matchers for "any value" in withArgs
function anyUint() { return (v) => typeof v === "bigint"; }
function anyBytes() { return (v) => typeof v === "string" && v.startsWith("0x"); }
