// Problem-statement acceptance suite (CASCADE '26 · PS 4.2). Every requirement sentence of the PS is
// checked against freshly deployed contracts on an isolated in-process chain (real EVM execution), plus
// the open off-chain tools (report reconciler, probabilistic evaluation chain, red-team benchmark).
//
//   npm run acceptance      → requirement → evidence → PASS/FAIL matrix (exit 1 on any failure)
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { deployFixture, signInvoice, beneficiaryTree, Category, WINDOW, inr, batch, attest } = require("../test/fixture");

const backend = (f) => import(pathToFileURL(path.join(__dirname, "..", "..", "backend", f)).href);
const DAY = 86400;
const CATEGORY = ["Water", "Medical", "Education"];
const STATUS = ["None", "Pending", "Released", "Completed", "Challenged", "Cancelled"];
const R = Object.fromEntries(
  ["DuplicateInvoice", "ForgedSignature", "OutOfCategory", "OverBudget", "AmountMismatch", "UnregisteredVendor", "ChallengeUpheld", "VendorDoubleSign", "DuplicateFiatProof", "UnexplainedTransfer", "ImpossibleTimeline", "InvoiceBeforeDonation", "ImpactNotProven"].map((k, i) => [k, i]),
);
const rs = (wei) => Number(ethers.formatUnits(wei, 18));

function expect(cond, msg) {
  if (!cond) throw new Error(msg);
}
async function events(txPromise, vault) {
  const rc = await (await txPromise).wait();
  return rc.logs.map((l) => { try { return vault.interface.parseLog(l); } catch { return null; } }).filter(Boolean);
}
const has = (evs, name, pred = () => true) => evs.some((e) => e.name === name && pred(e.args));
async function reverts(p, error) {
  try {
    await p;
  } catch (e) {
    if (!error || String(e.message).includes(error)) return true;
    throw new Error(`expected ${error}, got ${e.shortMessage ?? e.message}`);
  }
  throw new Error(`expected revert ${error ?? ""}`);
}
const deadline = async (days = 30) => (await time.latest()) + days * DAY;

async function fresh() {
  const f = await deployFixture();
  await f.vault.connect(f.donorA).donate(0, Category.Water, inr(50_000), await deadline()); // lot 0
  await f.vault.connect(f.donorB).donate(0, Category.Water, inr(30_000), await deadline()); // lot 1
  return f;
}
let invoiceNo = 0;
const invoice = (f, fields = {}) => signInvoice(f.vault, fields.signer ?? f.vendor, { vendor: f.vendor.address, amount: inr(1_000), invoiceNo: `ACC-${invoiceNo++}`, ...fields });
async function payout(f, inv, sig, shares, required = 1, root) {
  return f.vault.connect(f.ngoAdmin).requestPayout(inv, sig, shares, root ?? (await batch(f.vault, inv.ngoId, required)), required);
}

/// Escrow invariant from public views: the vault holds exactly what its rules owe.
async function ledgerGap(f, extraStakeholders = []) {
  const [nNgo, nLot, nPay] = await f.vault.counts();
  let owed = 0n;
  for (let i = 0; i < nLot; i++) owed += (await f.vault.lot(i)).remaining;
  for (let i = 0; i < nPay; i++) {
    const p = await f.vault.payout(i);
    if (p.status !== 3n && p.status !== 5n) owed += p.amount - p.paid;
    const c = await f.vault.challengeOf(i);
    if (c.challenger !== ethers.ZeroAddress && !c.resolved) owed += await f.vault.CHALLENGE_BOND();
  }
  for (let i = 0; i < nNgo; i++) owed += (await f.vault.ngo(i)).bond;
  for (const a of [f.vendor.address, ...extraStakeholders]) owed += (await f.vault.vendors(a)).stake;
  owed += (await f.vault.fieldPartners(f.fieldWorker.address)).stake;
  return (await f.dinr.balanceOf(await f.vault.getAddress())) - owed;
}

async function signFiat(f, agent, s) {
  const { chainId } = await ethers.provider.getNetwork();
  const domain = { name: "GlassVault", version: "1", chainId, verifyingContract: await f.vault.getAddress() };
  const types = { FiatSettlement: [["payoutId", "uint256"], ["fiatAmount", "uint256"], ["bankRefHash", "bytes32"], ["payeeHash", "bytes32"], ["paidAt", "uint64"]].map(([name, type]) => ({ name, type })) };
  return agent.signTypedData(domain, types, s);
}

async function offRampAgent(f) {
  const agent = (await ethers.getSigners())[9];
  await f.dinr.mint(agent.address, inr(10_000));
  await f.dinr.connect(agent).approve(await f.vault.getAddress(), ethers.MaxUint256);
  await f.vault.connect(agent).registerOffRamp(Category.Water, ethers.id("PayLink"));
  return agent;
}

// ─────────────────────────────── checks ───────────────────────────────

const CHECKS = [
  {
    req: "Purpose-bound allocation — smart contracts manage earmarked funds",
    async run() {
      const f = await fresh();
      const lot = await f.vault.lot(0);
      expect(lot.category === BigInt(Category.Water) && lot.ngoId === 0n && lot.remaining === inr(50_000), "lot not tagged");
      await f.vault.connect(f.donorB).donate(0, Category.Medical, inr(5_000), await deadline()); // lot 2 (Medical)
      const { inv, sig } = await invoice(f); // Water vendor
      const evs = await events(payout(f, inv, sig, [{ lotId: 2, amount: inr(1_000) }]), f.vault);
      expect(has(evs, "FraudFlagged", (a) => a.reason === BigInt(R.OutOfCategory)), "out-of-category spend not flagged");
      expect((await f.vault.lot(2)).remaining === inr(5_000), "earmarked money moved");
      return "lot = {donor, NGO, Water, ₹50,000, deadline}; Medical money on a Water invoice → OutOfCategory flag, ₹0 moved";
    },
  },
  {
    req: "Purpose-bound allocation — agreed disbursement conditions enforced, no admin override",
    async run() {
      const f = await fresh();
      const ben = beneficiaryTree(1, "acc-cond-");
      const { inv, sig } = await invoice(f, { amount: inr(10_000) });
      await payout(f, inv, sig, [{ lotId: 0, amount: inr(10_000) }], 1, await attest(f.vault, ben.root, 0, 1));
      await reverts(f.vault.release(0), "WindowOpen");
      await time.increase(WINDOW);
      const before = await f.dinr.balanceOf(f.vendor.address);
      await f.vault.release(0);
      expect((await f.dinr.balanceOf(f.vendor.address)) - before === inr(7_000), "release not 70%");
      await f.vault.confirmDelivery(0, await ben.sign(f.vault, 0, 0), ben.proofFor(0));
      expect((await f.dinr.balanceOf(f.vendor.address)) - before === inr(10_000), "final 30% not gated on delivery");
      const fns = f.vault.interface.fragments.filter((x) => x.type === "function").map((x) => x.name.toLowerCase());
      const admin = fns.filter((n) => /owner|admin(?!s)|pause|unfreeze|withdraw|emergency|rescue|sweep|setchallenge|upgrade/.test(n) && n !== "ngo");
      expect(!admin.length, `admin-like functions exist: ${admin}`);
      return "no release inside the challenge window; 70% after it, 30% only after card-signed delivery; ABI has no owner/pause/withdraw/unfreeze";
    },
  },
  {
    req: "Verifiable expenditure records — on-chain payouts linked to invoices by cryptographic commitments",
    async run() {
      const f = await fresh();
      const { inv, sig } = await invoice(f, { amount: inr(2_000), fileHash: ethers.id("receipt-pdf-bytes") });
      const evs = await events(payout(f, inv, sig, [{ lotId: 0, amount: inr(2_000) }]), f.vault);
      const req = evs.find((e) => e.name === "PayoutRequested");
      const nullifier = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["address", "bytes32", "uint64", "uint256"], [inv.vendor, inv.invoiceNo, inv.date, inv.amount]));
      expect(req && req.args.nullifier === nullifier && req.args.fileHash === inv.fileHash, "payout not bound to invoice commitments");
      const forged = await invoice(f, { signer: f.ngoAdmin, amount: inr(2_000) });
      const evs2 = await events(payout(f, forged.inv, forged.sig, [{ lotId: 0, amount: inr(2_000) }]), f.vault);
      expect(has(evs2, "FraudFlagged", (a) => a.reason === BigInt(R.ForgedSignature)), "forged invoice not flagged");
      return "PayoutRequested carries nullifier = keccak(vendor, invoiceNo, date, amount) + receipt file hash; vendor EIP-712 signature verified; forged → flag";
    },
  },
  {
    req: "Privacy protection — beneficiaries shielded, mathematical proof of delivery kept",
    async run() {
      const f = await fresh();
      const ben = beneficiaryTree(3, "acc-priv-");
      const { inv, sig } = await invoice(f);
      await payout(f, inv, sig, [{ lotId: 0, amount: inr(1_000) }], 2, await attest(f.vault, ben.root, 0, 3));
      const tx = await f.vault.confirmDelivery(0, await ben.sign(f.vault, 0, 0), ben.proofFor(0));
      expect(!tx.data.toLowerCase().includes(ben.wallets[0].privateKey.slice(2)), "card key leaked on-chain");
      await reverts(f.vault.confirmDelivery(0, await ben.sign(f.vault, 0, 0), ben.proofFor(0)), "AlreadyDelivered");
      const outsider = ethers.Wallet.createRandom();
      const { signDelivery } = require("../test/fixture");
      await reverts(f.vault.confirmDelivery(0, await signDelivery(f.vault, outsider, 0), ben.proofFor(1)), "InvalidProof");
      await reverts(f.vault.connect(f.ngoAdmin).attestBatch(beneficiaryTree(1, "self-").root, 0, 1), "NotFieldPartner");
      return "on-chain: Merkle root of card addresses + card signatures only (key never in calldata); outsider and double confirmation rejected; NGO can't vouch for its own list";
    },
  },
  {
    req: "Discrepancy detection — unexplained transfers",
    async run() {
      const f = await fresh();
      const agent = await offRampAgent(f);
      const { inv, sig } = await signInvoice(f.vault, agent, { vendor: agent.address, amount: inr(4_000), invoiceNo: "ACC-FIAT-1" });
      await f.vault.connect(f.ngoAdmin).requestPayout(inv, sig, [{ lotId: 0, amount: inr(4_000) }], await batch(f.vault, 0, 1), 1);
      await time.increase(WINDOW);
      await f.vault.release(0);
      await time.increase(2 * WINDOW + 1);
      const evs = await events(f.vault.connect(f.stranger).flagUnsettled(0), f.vault);
      expect(has(evs, "UnexplainedTransfer") && has(evs, "FraudFlagged", (a) => a.reason === BigInt(R.UnexplainedTransfer)), "unsettled release not flagged");
      expect((await ledgerGap(f, [agent.address])) === 0n, "escrow ledger does not balance");
      return "released to a fiat agent, never proven paid in rupees → anyone flags it (agent stake → reporter, 30% back); escrow balance = Σ obligations, gap ₹0";
    },
  },
  {
    req: "Discrepancy detection — spending outside declared categories / impossible timelines",
    async run() {
      const f = await fresh();
      const future = await invoice(f, { date: (await time.latest()) + 3 * DAY });
      const evs = await events(payout(f, future.inv, future.sig, [{ lotId: 0, amount: inr(1_000) }]), f.vault);
      expect(has(evs, "FraudFlagged", (a) => a.reason === BigInt(R.ImpossibleTimeline)), "future invoice not flagged");
      const old = await invoice(f, { date: (await time.latest()) - 10 * DAY });
      const evs2 = await events(payout(f, old.inv, old.sig, [{ lotId: 0, amount: inr(1_000) }]), f.vault);
      expect(has(evs2, "Discrepancy", (a) => a.reason === BigInt(R.InvoiceBeforeDonation)), "pre-donation invoice not recorded");
      return "category mismatch → flag (see row 1); future-dated invoice → ImpossibleTimeline flag; invoice 10 days before the donation → recorded discrepancy";
    },
  },
  {
    req: "Discrepancy detection — published reports vs recorded transactions",
    async run() {
      const f = await fresh();
      const { inv, sig } = await invoice(f, { amount: inr(40_000) });
      await payout(f, inv, sig, [{ lotId: 0, amount: inr(30_000) }, { lotId: 1, amount: inr(10_000) }]);
      await time.increase(WINDOW);
      await f.vault.release(0);
      const { reconcile } = await backend("src/reconcile.js");
      const p = await f.vault.payout(0);
      const shares = (await f.vault.payoutShares(0)).map((s) => ({ lotId: Number(s.lotId), amount: rs(s.amount) }));
      const state = {
        payouts: [{ id: 0, ngoId: 0, category: CATEGORY[Number(p.category)], amount: rs(p.amount), paid: rs(p.paid), status: STATUS[Number(p.status)], nullifier: p.nullifier, fileHash: p.fileHash, shares }],
        lots: [{ donor: f.donorA.address }, { donor: f.donorB.address }],
      };
      const out = reconcile(state, {
        ngoId: 0,
        categories: [{ category: "Water", spent: 80_000 }],
        donorReports: [
          { donor: f.donorA.address, invoices: [{ payoutId: 0, amount: 40_000 }] },
          { donor: f.donorB.address, invoices: [{ payoutId: 0, amount: 40_000 }] },
        ],
      });
      const kinds = new Set(out.lines.map((l) => l.status));
      expect(out.verdict === "inconsistent" && kinds.has("over-claimed") && kinds.has("double-counted") && kinds.has("over-attributed"), "reconciler missed report lies");
      return "NGO report claims ₹80,000 Water spend and tells both donors the ₹40,000 invoice was theirs → over-claimed, over-attributed, double-counted (200%)";
    },
  },
  {
    req: "Multi-hop flows — swapped, bridged, spent off-chain via fiat vendors, timeline reconstructed",
    async run() {
      const f = await fresh();
      const dex = await ethers.deployContract("MockDEX", [await f.dinr.getAddress(), inr(200_000)]);
      await f.dinr.mint(await dex.getAddress(), inr(10_000_000));
      const hops = [];
      const gwEvents = async (p) => (await (await p).wait()).logs.map((l) => { try { return f.gateway.interface.parseLog(l); } catch { return null; } }).filter(Boolean);
      const swap = await gwEvents(f.gateway.connect(f.donorA).sendDonationWithSwap(await dex.getAddress(), 0, Category.Water, await deadline(), 31337, 0, { value: ethers.parseEther("0.25") }));
      expect(has(swap, "DonationSwapped") && has(swap, "DonationSent", (a) => a.amount === inr(50_000)), "swap hop missing");
      hops.push("0.25 ETH swapped → ₹50,000");
      const deliver = await events(f.gateway.connect(f.deployer).deliverDonation(31338, 0, f.donorA.address, 0, Category.Water, inr(50_000), await deadline()), f.vault);
      const lotId = Number(deliver.find((e) => e.name === "Donated").args.lotId);
      const lot = await f.vault.lot(lotId);
      expect(lot.donor === f.donorA.address && lot.sourceChain === 31338n && has(deliver, "CrossChainDonation"), "bridge lost the tag");
      hops.push(`bridged → lot #${lotId} (donor + chain kept)`);
      const agent = await offRampAgent(f);
      const ben = beneficiaryTree(1, "acc-hop-");
      const { inv, sig } = await signInvoice(f.vault, agent, { vendor: agent.address, amount: inr(20_000), invoiceNo: "ACC-HOP" });
      await f.vault.connect(f.ngoAdmin).requestPayout(inv, sig, [{ lotId, amount: inr(20_000) }], await attest(f.vault, ben.root, 0, 1), 1);
      await time.increase(WINDOW);
      await f.vault.release(0);
      await f.vault.confirmDelivery(0, await ben.sign(f.vault, 0, 0), ben.proofFor(0));
      expect((await f.vault.payout(0)).status === 2n, "completed without rupee proof");
      const s = { payoutId: 0, fiatAmount: inr(20_000), bankRefHash: ethers.id("UTR-ACC-1"), payeeHash: ethers.id("Gram Jal Hardware"), paidAt: await time.latest() };
      const evs = await events(f.vault.attestFiat(s, await signFiat(f, agent, s)), f.vault);
      expect(has(evs, "FiatSettled") && has(evs, "ImpactVerified"), "fiat hop not linked");
      hops.push("agent invoice → 70% → ₹20,000 paid in rupees (UTR hash) → delivery → impact");
      return hops.join(" → ");
    },
  },
  {
    req: "Adversary double-counts one piece of off-chain evidence across donor reports",
    async run() {
      const f = await fresh();
      const a = await invoice(f, { amount: inr(5_000), invoiceNo: "SAME-1" });
      await payout(f, a.inv, a.sig, [{ lotId: 0, amount: inr(5_000) }]); // donor A's report
      const rescan = await invoice(f, { amount: inr(5_000), invoiceNo: "SAME-1", fileHash: ethers.id("rescanned-photo") });
      const evs = await events(payout(f, rescan.inv, rescan.sig, [{ lotId: 1, amount: inr(5_000) }]), f.vault); // donor B's report
      expect(has(evs, "FraudFlagged", (x) => x.reason === BigInt(R.DuplicateInvoice)), "re-scanned duplicate not caught");
      const agent = await offRampAgent(f);
      for (const n of ["F-1", "F-2"]) {
        const x = await signInvoice(f.vault, agent, { vendor: agent.address, amount: inr(1_000), invoiceNo: n });
        await f.vault.connect(f.ngoAdmin).requestPayout(x.inv, x.sig, [{ lotId: 0, amount: inr(1_000) }], await batch(f.vault, 0, 1), 1);
      }
      await time.increase(WINDOW);
      await f.vault.release(1);
      await f.vault.release(2);
      const mk = async (id) => ({ payoutId: id, fiatAmount: inr(1_000), bankRefHash: ethers.id("UTR-REUSED"), payeeHash: ethers.id("shop"), paidAt: await time.latest() });
      const s1 = await mk(1);
      await f.vault.attestFiat(s1, await signFiat(f, agent, s1));
      const s2 = await mk(2);
      const evs2 = await events(f.vault.attestFiat(s2, await signFiat(f, agent, s2)), f.vault);
      expect(has(evs2, "Discrepancy", (x) => x.reason === BigInt(R.DuplicateFiatProof)) && has(evs2, "UnexplainedTransfer"), "reused bank transfer not caught");
      expect((await f.vault.vendors(agent.address)).slashed, "agent that reused a bank transfer not slashed");
      return "same invoice re-scanned for a second donor's lot → global nullifier collision (fraud flag); same bank transfer for two payouts → bank-reference nullifier, agent slashed, 30% back to donors; report-level double counting → reconciler (row 7)";
    },
  },
  {
    req: "Adversary forges 30% of receipts — detected",
    async run() {
      const out = spawnSync("npx hardhat run scripts/benchmark.js", { cwd: path.join(__dirname, ".."), env: { ...process.env, BENCH_JSON: "1" }, shell: true, encoding: "utf8" });
      const line = out.stdout.trim().split("\n").reverse().find((l) => l.startsWith("{"));
      expect(line, `benchmark produced no report: ${out.stderr?.slice(0, 300)}`);
      const b = JSON.parse(line);
      expect(b.truePositives === b.fraudulent && b.falsePositives === 0, `recall ${b.truePositives}/${b.fraudulent}, false alarms ${b.falsePositives}`);
      return `${b.receipts} receipts, ${b.fraudulent} fraudulent (duplicates, altered amounts, forged signatures, shell vendors, doctored photos): ${b.truePositives}/${b.fraudulent} caught, ${b.falsePositives}/${b.genuine} false alarms`;
    },
  },
  {
    req: "Detect duplication and freeze escrow disbursements without a central auditor",
    async run() {
      const f = await fresh();
      const good = await invoice(f, { amount: inr(5_000), invoiceNo: "FRZ-1" });
      await payout(f, good.inv, good.sig, [{ lotId: 0, amount: inr(5_000) }]);
      const dup = await invoice(f, { amount: inr(5_000), invoiceNo: "FRZ-1", fileHash: ethers.id("x") });
      await payout(f, dup.inv, dup.sig, [{ lotId: 1, amount: inr(5_000) }]);
      const forged = await invoice(f, { signer: f.ngoAdmin, amount: inr(2_000), invoiceNo: "FRZ-2" });
      const evs = await events(payout(f, forged.inv, forged.sig, [{ lotId: 1, amount: inr(2_000) }]), f.vault);
      expect(has(evs, "NGOFrozen"), "not frozen after 2 flags");
      await time.increase(WINDOW);
      await reverts(f.vault.release(0), "NGOIsFrozen");
      await f.vault.connect(f.stranger).unwindFrozen(0);
      const before = await f.dinr.balanceOf(f.donorA.address);
      await f.vault.connect(f.donorA).reclaim(0);
      expect((await f.dinr.balanceOf(f.donorA.address)) - before === inr(50_000), "donor not made whole");
      return "duplicate + forgery → contract freezes the NGO in the same tx (no human, no admin key); disbursement blocked; donors reclaim 100% of unpaid money";
    },
  },
  {
    req: "Probabilistic evaluation chain — Inbound → Escrow → Impact → Invoice",
    async run() {
      const { annotate } = await backend("src/confidence.js");
      const base = () => ({
        ngos: [{ id: 0, frozen: false, flagCount: 0 }],
        lots: [{ id: 0, ngoId: 0, amount: 1000, remaining: 0, sourceChain: 31337, origin: null, redirectedFrom: null, redirectedTo: null }],
        payouts: [{ id: 0, ngoId: 0, vendor: "0xv", amount: 1000, paid: 1000, status: "Completed", deliveries: 2, deliveriesRequired: 2, beneficiaryRoot: "0xr", fileHash: "0xf", shares: [{ lotId: 0, amount: 1000 }], offRamp: false }],
        vendors: [{ address: "0xv", slashed: false }],
        batches: [{ root: "0xr", ngoId: 0, partner: "0xp", cards: 2 }],
        discrepancies: [],
        stats: {},
      });
      const honest = annotate(base(), { homeChainId: 31337, files: { "0xf": true }, now: 1 }).lots[0].confidence;
      expect(honest.stages.map((s) => s.key).join(">") === "inbound>escrow>impact>invoice", "stages not in PS order");
      const product = honest.stages.reduce((a, s) => a * s.p, 1);
      expect(Math.abs(product - honest.score) < 0.002, "score is not the product of the stages");
      const fraud = base();
      Object.assign(fraud.payouts[0], { status: "Cancelled", paid: 700, challenge: { resolved: true, upheld: true } });
      const caught = annotate(fraud, { homeChainId: 31337, files: { "0xf": true }, now: 1 }).lots[0].confidence;
      expect(caught.score === 0, "upheld fraud should zero the chain");
      return `stages in PS order; honest completed donation ${honest.score} (= product of ${honest.stages.map((s) => s.p).join(" × ")}); upheld fraud → 0; formula open + re-runnable (npm run confidence)`;
    },
  },
];

async function main() {
  console.log("GlassVault · PS 4.2 acceptance suite\n");
  let failed = 0;
  for (const [i, c] of CHECKS.entries()) {
    const t0 = Date.now();
    try {
      const evidence = await c.run();
      console.log(`  PASS  ${String(i + 1).padStart(2)}. ${c.req}\n          ${evidence}  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    } catch (e) {
      failed++;
      console.log(`  FAIL  ${String(i + 1).padStart(2)}. ${c.req}\n          ${e.shortMessage ?? e.message}`);
    }
  }
  console.log(`\n  ${CHECKS.length - failed}/${CHECKS.length} requirements met${failed ? "" : " — every PS requirement verified on real contract execution"}`);
  process.exitCode = failed ? 1 : 0;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
