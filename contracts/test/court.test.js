const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { deployFixture, signInvoice, beneficiaryTree, Category, WINDOW, inr, ROOT, freshRoot } = require("./fixture");

const S = { Pending: 1, Released: 2, Completed: 3, Challenged: 4, Cancelled: 5 };
const in30d = async () => (await time.latest()) + 30 * 86400;

// donorA funds lot 0, donorB funds lot 1; payout 0 charges 30k from lot 0 + 10k from lot 1
async function pendingPayout() {
  const f = await loadFixture(deployFixture);
  await f.vault.connect(f.donorA).donate(0, Category.Water, inr(50_000), await in30d());
  await f.vault.connect(f.donorB).donate(0, Category.Water, inr(30_000), await in30d());
  const { inv, sig } = await signInvoice(f.vault, f.vendor, { vendor: f.vendor.address, amount: inr(40_000) });
  await f.vault.connect(f.ngoAdmin).requestPayout(inv, sig, [{ lotId: 0, amount: inr(30_000) }, { lotId: 1, amount: inr(10_000) }], freshRoot(), 1);
  return f;
}

describe("Stakes", () => {
  it("NGOs post a bond and vendors post a stake on registration", async () => {
    const { vault, vendor } = await loadFixture(deployFixture);
    expect((await vault.ngo(0)).bond).to.equal(inr(10_000));
    expect((await vault.vendors(vendor.address)).stake).to.equal(inr(5_000));
  });
});

describe("Challenge court — donors decide, no auditor", () => {
  it("anyone can challenge during the window by posting a bond", async () => {
    const { vault, stranger } = await pendingPayout();
    await expect(vault.connect(stranger).challenge(0, ethers.id("evidence"), "ipfs://evidence"))
      .to.emit(vault, "Challenged");
    expect((await vault.payout(0)).status).to.equal(S.Challenged);
    await time.increase(WINDOW);
    await expect(vault.release(0)).to.be.revertedWithCustomError(vault, "BadPayout"); // frozen in dispute
  });

  it("cannot challenge after the window closes", async () => {
    const { vault, stranger } = await pendingPayout();
    await time.increase(WINDOW);
    await expect(vault.connect(stranger).challenge(0, ethers.id("e"), "")).to.be.revertedWithCustomError(vault, "WindowClosed");
  });

  it("only donors whose money is in the payout can vote, weighted by amount", async () => {
    const { vault, stranger, donorA } = await pendingPayout();
    await vault.connect(stranger).challenge(0, ethers.id("e"), "");
    await expect(vault.connect(stranger).vote(0, true)).to.be.revertedWithCustomError(vault, "NotDonorOfPayout");
    await expect(vault.connect(donorA).vote(0, true)).to.emit(vault, "Voted").withArgs(0, donorA.address, true, inr(30_000));
    await expect(vault.connect(donorA).vote(0, true)).to.be.revertedWithCustomError(vault, "AlreadyVoted");
  });

  it("upheld: payout cancelled, funds return to lots, NGO bond + vendor stake slashed to challenger", async () => {
    const { vault, dinr, stranger, donorA, donorB, vendor } = await pendingPayout();
    const before = await dinr.balanceOf(stranger.address);
    await vault.connect(stranger).challenge(0, ethers.id("e"), "");
    await vault.connect(donorA).vote(0, true);  // 30k weight
    await vault.connect(donorB).vote(0, false); // 10k weight
    await expect(vault.resolve(0)).to.be.revertedWithCustomError(vault, "VotingOpen");
    await time.increase(WINDOW);

    await expect(vault.resolve(0)).to.emit(vault, "ChallengeResolved").withArgs(0, true, inr(500 + 5_000 + 5_000));
    expect((await vault.payout(0)).status).to.equal(S.Cancelled);
    expect((await vault.lot(0)).remaining).to.equal(inr(50_000));
    expect((await vault.lot(1)).remaining).to.equal(inr(30_000));
    expect(await dinr.balanceOf(stranger.address)).to.equal(before + inr(5_000 + 5_000)); // bond back + rewards
    expect((await vault.vendors(vendor.address)).registered).to.equal(false);
    expect((await vault.vendors(vendor.address)).slashed).to.equal(true); // can never re-register
    expect((await vault.ngo(0)).flagCount).to.equal(1);
  });

  it("rejected: payout resumes and challenger bond compensates the NGO", async () => {
    const { vault, dinr, stranger, donorA, ngoAdmin } = await pendingPayout();
    await vault.connect(stranger).challenge(0, ethers.id("e"), "");
    await vault.connect(donorA).vote(0, false);
    await time.increase(WINDOW);
    const before = await dinr.balanceOf(ngoAdmin.address);
    await vault.resolve(0);
    expect(await dinr.balanceOf(ngoAdmin.address)).to.equal(before + inr(500));
    expect((await vault.payout(0)).status).to.equal(S.Pending);
    await vault.release(0);
    expect((await vault.payout(0)).status).to.equal(S.Released);
  });

  it("quorum: a tiny donor alone cannot uphold a challenge", async () => {
    const { vault, stranger, donorB } = await pendingPayout(); // donorB funds only 10k of the 40k payout
    await vault.connect(stranger).challenge(0, ethers.id("e"), "");
    await vault.connect(donorB).vote(0, true);
    await time.increase(WINDOW);
    await expect(vault.resolve(0)).to.emit(vault, "ChallengeResolved").withArgs(0, false, inr(500));
    expect((await vault.ngo(0)).flagCount).to.equal(0);
  });

  it("a challenged payout of a frozen NGO cannot be unwound before resolve (challenger bond stays safe)", async () => {
    const { vault, stranger, vendor, ngoAdmin } = await pendingPayout();
    await vault.connect(stranger).challenge(0, ethers.id("e"), "");
    for (const no of ["F1", "F2"]) {
      const f = await signInvoice(vault, ngoAdmin, { vendor: vendor.address, amount: inr(1), invoiceNo: no });
      await vault.connect(ngoAdmin).requestPayout(f.inv, f.sig, [{ lotId: 0, amount: inr(1) }], freshRoot(), 1);
    }
    await expect(vault.unwindFrozen(0)).to.be.revertedWithCustomError(vault, "BadPayout");
  });
});

describe("Hardening", () => {
  it("every payout must carry an impact proof requirement", async () => {
    const f = await pendingPayout();
    const { inv, sig } = await signInvoice(f.vault, f.vendor, { vendor: f.vendor.address, amount: inr(1), invoiceNo: "N" });
    await expect(f.vault.connect(f.ngoAdmin).requestPayout(inv, sig, [{ lotId: 0, amount: inr(1) }], ethers.ZeroHash, 1))
      .to.be.revertedWithCustomError(f.vault, "ImpactProofRequired");
    await expect(f.vault.connect(f.ngoAdmin).requestPayout(inv, sig, [{ lotId: 0, amount: inr(1) }], freshRoot(), 0))
      .to.be.revertedWithCustomError(f.vault, "ImpactProofRequired");
  });

  it("vendors cannot re-categorise to frame an NGO", async () => {
    const { vault, vendor } = await loadFixture(deployFixture);
    await expect(vault.connect(vendor).registerVendor(Category.Medical, ethers.ZeroHash)).to.be.revertedWithCustomError(vault, "CategoryLocked");
  });

  it("donations need a real proof deadline, and expired lots cannot be charged", async () => {
    const f = await pendingPayout();
    await expect(f.vault.connect(f.donorA).donate(0, Category.Water, inr(1), await time.latest())).to.be.revertedWithCustomError(f.vault, "DeadlineTooSoon");
    await time.increase(31 * 86400);
    const { inv, sig } = await signInvoice(f.vault, f.vendor, { vendor: f.vendor.address, amount: inr(1), invoiceNo: "LATE" });
    await expect(f.vault.connect(f.ngoAdmin).requestPayout(inv, sig, [{ lotId: 0, amount: inr(1) }], freshRoot(), 1))
      .to.be.revertedWithCustomError(f.vault, "LotExpired");
  });

  it("only the bridge gateway can create cross-chain lots", async () => {
    const { vault, stranger } = await loadFixture(deployFixture);
    await expect(vault.connect(stranger).donateFor(stranger.address, 0, 0, inr(1), (await time.latest()) + 86400, 1))
      .to.be.revertedWithCustomError(vault, "OnlyGateway");
  });
});

describe("Refunds", () => {
  it("donor cannot reclaim while the NGO is healthy and before the deadline", async () => {
    const { vault, donorA } = await pendingPayout();
    await expect(vault.connect(donorA).reclaim(0)).to.be.revertedWithCustomError(vault, "NotReclaimable");
  });

  it("dead-man switch: donor reclaims unspent funds after the deadline", async () => {
    const { vault, dinr, donorA } = await pendingPayout();
    await time.increase(31 * 86400);
    const before = await dinr.balanceOf(donorA.address);
    await vault.connect(donorA).reclaim(0);
    expect(await dinr.balanceOf(donorA.address)).to.equal(before + inr(20_000)); // 50k - 30k reserved
  });

  it("after a freeze, pending payouts unwind and donors get everything unpaid back", async () => {
    const { vault, dinr, vendor, ngoAdmin, donorA } = await pendingPayout();
    // two forged invoices → auto-freeze
    for (const no of ["F1", "F2"]) {
      const f = await signInvoice(vault, ngoAdmin, { vendor: vendor.address, amount: inr(1), invoiceNo: no });
      await vault.connect(ngoAdmin).requestPayout(f.inv, f.sig, [{ lotId: 0, amount: inr(1) }], freshRoot(), 1);
    }
    expect((await vault.ngo(0)).frozen).to.equal(true);
    await vault.unwindFrozen(0);
    const before = await dinr.balanceOf(donorA.address);
    await vault.connect(donorA).reclaim(0);
    expect(await dinr.balanceOf(donorA.address)).to.equal(before + inr(50_000));
  });

  it("only the lot's donor can reclaim it", async () => {
    const { vault, donorB } = await pendingPayout();
    await expect(vault.connect(donorB).reclaim(0)).to.be.revertedWithCustomError(vault, "NotLotDonor");
  });
});

describe("Proof-of-Impact soulbound token", () => {
  it("each funding donor gets a non-transferable token when impact is verified", async () => {
    const f = await loadFixture(deployFixture);
    await f.vault.connect(f.donorA).donate(0, Category.Water, inr(5_000), await in30d());
    await f.vault.connect(f.donorB).donate(0, Category.Water, inr(5_000), await in30d());
    const ben = beneficiaryTree(1);
    const { inv, sig } = await signInvoice(f.vault, f.vendor, { vendor: f.vendor.address, amount: inr(6_000) });
    await f.vault.connect(f.ngoAdmin).requestPayout(inv, sig, [{ lotId: 0, amount: inr(3_000) }, { lotId: 1, amount: inr(3_000) }], ben.root, 1);
    await f.vault.confirmDelivery(0, ben.secrets[0], ben.proofFor(0));
    await time.increase(WINDOW);
    await f.vault.release(0);

    const sbt = await ethers.getContractAt("ProofOfImpact", await f.vault.impactToken());
    expect(await sbt.ownerOf(0)).to.equal(f.donorA.address);
    expect(await sbt.ownerOf(1)).to.equal(f.donorB.address);
    await expect(sbt.connect(f.donorA).transferFrom(f.donorA.address, f.stranger.address, 0)).to.be.revertedWithCustomError(sbt, "Soulbound");
  });
});

describe("Trust score", () => {
  it("rises with completed impact and drops to 0 when frozen", async () => {
    const f = await loadFixture(deployFixture);
    expect(await f.vault.trustScore(0)).to.equal(60);
    await f.vault.connect(f.donorA).donate(0, Category.Water, inr(1_000), await in30d());
    const ben = beneficiaryTree(1);
    const { inv, sig } = await signInvoice(f.vault, f.vendor, { vendor: f.vendor.address, amount: inr(1_000) });
    await f.vault.connect(f.ngoAdmin).requestPayout(inv, sig, [{ lotId: 0, amount: inr(1_000) }], ben.root, 1);
    await f.vault.confirmDelivery(0, ben.secrets[0], ben.proofFor(0));
    await time.increase(WINDOW);
    await f.vault.release(0); // delivery already proven → completes
    expect(await f.vault.trustScore(0)).to.equal(100);

    for (const no of ["X1", "X2"]) {
      const x = await signInvoice(f.vault, f.ngoAdmin, { vendor: f.vendor.address, amount: inr(1), invoiceNo: no });
      await f.vault.connect(f.ngoAdmin).requestPayout(x.inv, x.sig, [{ lotId: 0, amount: inr(1) }], freshRoot(), 1);
    }
    expect(await f.vault.trustScore(0)).to.equal(0);
  });
});

describe("Cross-chain donation (bridge keeps the tag)", () => {
  it("delivers a chain-B donation into a vault lot with the original donor + source chain, once", async () => {
    const f = await loadFixture(deployFixture);
    const gw = f.gateway; // deployer is the relayer

    const args = [31338, 7, f.donorB.address, 0, Category.Water, inr(12_000), await in30d()];
    await expect(gw.deliverDonation(...args)).to.emit(f.vault, "CrossChainDonation").withArgs(0, 31338, await gw.getAddress());
    const lot = await f.vault.lot(0);
    expect(lot.donor).to.equal(f.donorB.address);
    expect(lot.sourceChain).to.equal(31338);
    await expect(gw.deliverDonation(...args)).to.be.revertedWithCustomError(gw, "AlreadyDelivered");
    await expect(gw.connect(f.stranger).deliverDonation(31338, 8, f.donorB.address, 0, 0, 1, 0)).to.be.revertedWithCustomError(gw, "OnlyRelayer");
  });

  it("source side locks tokens and emits the tag", async () => {
    const f = await loadFixture(deployFixture);
    const gw = await ethers.deployContract("BridgeGateway", [await f.dinr.getAddress(), f.deployer.address]);
    await f.dinr.connect(f.donorA).approve(await gw.getAddress(), ethers.MaxUint256);
    await expect(gw.connect(f.donorA).sendDonation(0, Category.Medical, inr(2_000), 0, 31337))
      .to.emit(gw, "DonationSent").withArgs(0, f.donorA.address, 0, Category.Medical, inr(2_000), 0, 31337);
    expect(await f.dinr.balanceOf(await gw.getAddress())).to.equal(inr(2_000));
  });
});
