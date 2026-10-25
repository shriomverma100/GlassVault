const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { deployFixture, signInvoice, beneficiaryTree, Category, WINDOW, inr, freshRoot } = require("./fixture");

const FR = { DuplicateFiatProof: 8, UnexplainedTransfer: 9 };
const RATE = inr(200_000); // ₹2,00,000 per ETH
const deadline = () => Math.floor(Date.now() / 1000) + 30 * 86400;
const anyBytes = () => (v) => typeof v === "string" && v.startsWith("0x");

async function withDex() {
  const f = await loadFixture(deployFixture);
  const dex = await ethers.deployContract("MockDEX", [await f.dinr.getAddress(), RATE]);
  await f.dinr.mint(await dex.getAddress(), inr(100_000_000));
  return { ...f, dex };
}

/// Off-ramp agent registered, a funded Water lot, and a payout to the agent with 1 beneficiary card.
async function offRampPayout(amount = 20_000) {
  const f = await withDex();
  const [, , , , , , , , agent] = await ethers.getSigners();
  await f.dinr.mint(agent.address, inr(10_000));
  await f.dinr.connect(agent).approve(await f.vault.getAddress(), ethers.MaxUint256);
  await f.vault.connect(agent).registerOffRamp(Category.Water, ethers.id("PayLink Fiat Agents"));
  await f.vault.connect(f.donorA).donate(0, Category.Water, inr(50_000), deadline()); // lot 0
  const ben = beneficiaryTree(1, `fiat-${amount}-`);
  const { inv, sig } = await signInvoice(f.vault, agent, { vendor: agent.address, amount: inr(amount), invoiceNo: `PL-${amount}` });
  await f.vault.connect(f.ngoAdmin).requestPayout(inv, sig, [{ lotId: 0, amount: inr(amount) }], ben.root, 1);
  return { ...f, agent, ben, payoutId: 0 };
}

async function signFiat(vault, signer, fields) {
  const { chainId } = await ethers.provider.getNetwork();
  const domain = { name: "GlassVault", version: "1", chainId, verifyingContract: await vault.getAddress() };
  const types = {
    FiatSettlement: [
      { name: "payoutId", type: "uint256" },
      { name: "fiatAmount", type: "uint256" },
      { name: "bankRefHash", type: "bytes32" },
      { name: "payeeHash", type: "bytes32" },
      { name: "paidAt", type: "uint64" },
    ],
  };
  const s = {
    payoutId: fields.payoutId,
    fiatAmount: fields.fiatAmount,
    bankRefHash: ethers.id(fields.bankRef ?? "UTR-SBIN-0001"),
    payeeHash: ethers.id(fields.payee ?? "Gram Jal Hardware, Wadgaon"),
    paidAt: fields.paidAt ?? (await time.latest()),
  };
  return { s, sig: await signer.signTypedData(domain, types, s) };
}

describe("Multi-hop donation — swap → bridge (tag survives both hops)", () => {
  it("swaps ETH to dINR, locks it and emits the swap hop linked to the bridge nonce", async () => {
    const { gateway, dex, dinr, donorA } = await withDex();
    const eth = ethers.parseEther("0.25");
    const quote = await dex.quote(eth);
    expect(quote).to.equal(inr(50_000));
    const before = await dinr.balanceOf(await gateway.getAddress());
    await expect(gateway.connect(donorA).sendDonationWithSwap(await dex.getAddress(), 0, Category.Water, deadline(), 31337, quote, { value: eth }))
      .to.emit(gateway, "DonationSwapped").withArgs(0, donorA.address, await dex.getAddress(), eth, quote)
      .and.to.emit(gateway, "DonationSent").withArgs(0, donorA.address, 0, Category.Water, quote, anyNum(), 31337)
      .and.to.emit(dex, "Swapped");
    expect((await dinr.balanceOf(await gateway.getAddress())) - before).to.equal(quote);
  });

  it("the relayed lot keeps the original donor and source chain", async () => {
    const { gateway, dex, vault, donorA, deployer } = await withDex();
    const eth = ethers.parseEther("0.25");
    await gateway.connect(donorA).sendDonationWithSwap(await dex.getAddress(), 0, Category.Water, deadline(), 31337, 0, { value: eth });
    await gateway.connect(deployer).deliverDonation(31338, 0, donorA.address, 0, Category.Water, inr(50_000), deadline());
    const lot = await vault.lot(0);
    expect(lot.donor).to.equal(donorA.address);
    expect(lot.sourceChain).to.equal(31338);
    expect(lot.amount).to.equal(inr(50_000));
  });

  it("rejects a swap below the donor's minimum (slippage)", async () => {
    const { gateway, dex, donorA } = await withDex();
    const eth = ethers.parseEther("1");
    await expect(gateway.connect(donorA).sendDonationWithSwap(await dex.getAddress(), 0, Category.Water, deadline(), 31337, inr(300_000), { value: eth }))
      .to.be.revertedWithCustomError(dex, "Slippage");
  });
});

describe("Off-chain fiat off-ramp — rupee payment proven or flagged", () => {
  it("final 30% waits for BOTH delivery proof and the agent's signed fiat settlement", async () => {
    const { vault, dinr, agent, ben, payoutId, fieldWorker } = await offRampPayout();
    await vault.connect(fieldWorker).confirmDelivery(payoutId, ben.secrets[0], ben.proofFor(0));
    await time.increase(WINDOW);
    const start = await dinr.balanceOf(agent.address);
    await vault.release(payoutId);
    expect((await vault.payout(payoutId)).status).to.equal(2); // Released — deliveries alone are not enough
    expect((await dinr.balanceOf(agent.address)) - start).to.equal(inr(14_000)); // 70%

    const { s, sig } = await signFiat(vault, agent, { payoutId, fiatAmount: inr(20_000) });
    await expect(vault.attestFiat(s, sig)) // anyone can submit — the agent's signature is the proof
      .to.emit(vault, "FiatSettled").withArgs(payoutId, agent.address, inr(20_000), s.bankRefHash, s.payeeHash, s.paidAt)
      .and.to.emit(vault, "ImpactVerified");
    expect((await vault.payout(payoutId)).status).to.equal(3); // Completed
    expect((await dinr.balanceOf(agent.address)) - start).to.equal(inr(20_000)); // + final 30%
    expect(await vault.fiatProof(payoutId)).to.equal(s.bankRefHash);
  });

  it("flags the same bank transfer used to settle two payouts (double-counted fiat evidence)", async () => {
    const f = await offRampPayout();
    const { vault, agent, ngoAdmin } = f;
    const second = await signInvoice(vault, agent, { vendor: agent.address, amount: inr(10_000), invoiceNo: "PL-SECOND" });
    await vault.connect(ngoAdmin).requestPayout(second.inv, second.sig, [{ lotId: 0, amount: inr(10_000) }], freshRoot(), 1);
    await time.increase(WINDOW);
    await vault.release(0);
    await vault.release(1);
    const a = await signFiat(vault, agent, { payoutId: 0, fiatAmount: inr(20_000), bankRef: "UTR-SAME" });
    await vault.attestFiat(a.s, a.sig);
    const b = await signFiat(vault, agent, { payoutId: 1, fiatAmount: inr(10_000), bankRef: "UTR-SAME" });
    await expect(vault.attestFiat(b.s, b.sig)).to.emit(vault, "FraudFlagged").withArgs(0, FR.DuplicateFiatProof, b.s.bankRefHash, anyBytes(), 1);
    expect(await vault.fiatProof(1)).to.equal(ethers.ZeroHash);
  });

  it("rejects settlements not signed by the agent, dated before release, or above the invoice", async () => {
    const { vault, agent, ngoAdmin, payoutId } = await offRampPayout();
    await time.increase(WINDOW);
    await vault.release(payoutId);
    const forged = await signFiat(vault, ngoAdmin, { payoutId, fiatAmount: inr(20_000) });
    await expect(vault.attestFiat(forged.s, forged.sig)).to.be.revertedWithCustomError(vault, "BadSettlement");
    const early = await signFiat(vault, agent, { payoutId, fiatAmount: inr(20_000), paidAt: 1 });
    await expect(vault.attestFiat(early.s, early.sig)).to.be.revertedWithCustomError(vault, "BadSettlement");
    const inflated = await signFiat(vault, agent, { payoutId, fiatAmount: inr(25_000) });
    await expect(vault.attestFiat(inflated.s, inflated.sig)).to.be.revertedWithCustomError(vault, "BadSettlement");
  });

  it("an unsettled payout becomes an unexplained transfer: reporter paid, agent banned, NGO flagged, 30% back to donors", async () => {
    const { vault, dinr, agent, payoutId, stranger } = await offRampPayout();
    await time.increase(WINDOW);
    await vault.release(payoutId);
    await expect(vault.connect(stranger).flagUnsettled(payoutId)).to.be.revertedWithCustomError(vault, "SettlementOpen");

    await time.increase(2 * WINDOW + 1);
    const lotBefore = (await vault.lot(0)).remaining;
    const before = await dinr.balanceOf(stranger.address);
    await expect(vault.connect(stranger).flagUnsettled(payoutId))
      .to.emit(vault, "UnexplainedTransfer").withArgs(payoutId, agent.address, stranger.address, inr(5_000))
      .and.to.emit(vault, "FraudFlagged").withArgs(0, FR.UnexplainedTransfer, anyBytes(), anyBytes(), 1);
    expect((await dinr.balanceOf(stranger.address)) - before).to.equal(inr(5_000)); // agent's stake → whistleblower
    expect((await vault.lot(0)).remaining - lotBefore).to.equal(inr(6_000)); // unpaid 30% back to the donor's lot
    expect((await vault.payout(payoutId)).status).to.equal(5); // Cancelled
    expect((await vault.vendors(agent.address)).slashed).to.equal(true);
  });

  it("supplier vendors can't post fiat settlements and can't switch role", async () => {
    const f = await withDex();
    const { vault, vendor, ngoAdmin, donorA } = f;
    await vault.connect(donorA).donate(0, Category.Water, inr(10_000), deadline());
    const { inv, sig } = await signInvoice(vault, vendor, { vendor: vendor.address, amount: inr(1_000) });
    await vault.connect(ngoAdmin).requestPayout(inv, sig, [{ lotId: 0, amount: inr(1_000) }], freshRoot(), 1);
    await time.increase(WINDOW);
    await vault.release(0);
    const s = await signFiat(vault, vendor, { payoutId: 0, fiatAmount: inr(1_000) });
    await expect(vault.attestFiat(s.s, s.sig)).to.be.revertedWithCustomError(vault, "NotOffRamp");
    await expect(vault.flagUnsettled(0)).to.be.revertedWithCustomError(vault, "NotOffRamp");
    await expect(vault.connect(vendor).registerOffRamp(Category.Water, ethers.id("x"))).to.be.revertedWithCustomError(vault, "RoleLocked");
  });
});

function anyNum() {
  return (v) => typeof v === "bigint";
}
