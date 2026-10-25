import { EventEmitter } from "node:events";
import { ethers } from "ethers";
import { db } from "./store.js";

const CATEGORY = ["Water", "Medical", "Education"];
const PAYOUT_STATUS = ["None", "Pending", "Released", "Completed", "Challenged", "Cancelled"];
const FRAUD_REASON = ["DuplicateInvoice", "ForgedSignature", "OutOfCategory", "OverBudget", "AmountMismatch", "UnregisteredVendor", "ChallengeUpheld", "VendorDoubleSign"];

const fmt = (v) => Number(ethers.formatUnits(v, 18)); // dINR → rupees (demo amounts stay well inside float precision)

/// Reads chain logs (A: vault + gateway, B: gateway) into an activity feed and keeps a state
/// snapshot built from the contracts' own view functions. The chain is the only source of truth.
export class Indexer extends EventEmitter {
  constructor({ depA, depB, providerA, providerB }) {
    super();
    this.vault = new ethers.Contract(depA.GlassVault.address, depA.GlassVault.abi, providerA);
    this.gatewayA = new ethers.Contract(depA.BridgeGateway.address, depA.BridgeGateway.abi, providerA);
    this.gatewayB = new ethers.Contract(depB.BridgeGateway.address, depB.BridgeGateway.abi, providerB);
    this.sources = [
      { chain: depA.chainId, provider: providerA, contracts: [this.vault, this.gatewayA], from: 0 },
      { chain: depB.chainId, provider: providerB, contracts: [this.gatewayB], from: 0 },
    ];
    this.events = [];
    this.eventIds = new Set(); // a poll that fails half-way re-reads logs it already ingested
    this.flags = []; // fraud caught: NGO flags + vendor slashes
    this.discrepancies = []; // rejected requests that do NOT count toward a freeze
    this.challengeRewards = 0; // everything paid to challengers whose challenge was upheld
    this.reclaimed = new Map(); // lotId → rupees a donor took back
    this.vendors = new Map();
    this.state = null;
    this.blockTimes = new Map();
  }

  async start() {
    await this.poll();
    this.timer = setInterval(() => this.poll().catch((e) => console.error("[indexer]", e.message)), 1000);
  }

  stop() {
    clearInterval(this.timer);
  }

  async poll() {
    let changed = false;
    for (const src of this.sources) {
      const latest = await src.provider.getBlockNumber();
      if (latest < src.from) continue;
      for (const c of src.contracts) {
        const logs = await src.provider.getLogs({ address: c.target, fromBlock: src.from, toBlock: latest });
        for (const log of logs) {
          const parsed = c.interface.parseLog(log);
          if (!parsed) continue;
          await this.ingest(src, log, parsed);
          changed = true;
        }
      }
      src.from = latest + 1;
    }
    if (changed || !this.state) {
      this.events.sort((a, b) => a.chainId - b.chainId || a.block - b.block || a.logIndex - b.logIndex);
      await this.snapshot();
      this.emit("state", this.state);
    }
  }

  async blockTime(provider, chainId, block) {
    const key = `${chainId}:${block}`;
    if (!this.blockTimes.has(key)) this.blockTimes.set(key, (await provider.getBlock(block)).timestamp);
    return this.blockTimes.get(key);
  }

  async ingest(src, log, parsed) {
    const args = {};
    parsed.fragment.inputs.forEach((input, i) => {
      const v = parsed.args[i];
      args[input.name] = typeof v === "bigint" ? v.toString() : v;
    });
    const id = `${src.chain}:${log.transactionHash}:${log.index}`;
    if (this.eventIds.has(id)) return;
    this.eventIds.add(id);
    const ev = {
      id,
      chainId: src.chain,
      contract: log.address,
      name: parsed.name,
      args,
      block: log.blockNumber,
      logIndex: log.index,
      tx: log.transactionHash,
      time: await this.blockTime(src.provider, src.chain, log.blockNumber),
    };
    this.events.push(ev);
    // decoded by name: an older deployment's ABI simply never yields the newer events
    if (parsed.name === "FraudFlagged") {
      this.flags.push({ ...ev, kind: "ngo", ngoId: Number(args.ngoId), reason: FRAUD_REASON[Number(args.reason)], file: db.files[args.fileHash] ?? null });
    }
    if (parsed.name === "VendorSlashed") {
      this.flags.push({ ...ev, kind: "vendor", ngoId: null, vendor: args.vendor, reason: "VendorDoubleSign", file: null });
    }
    if (parsed.name === "Discrepancy") {
      this.discrepancies.push({ ...ev, ngoId: Number(args.ngoId), reason: FRAUD_REASON[Number(args.reason)], file: db.files[args.fileHash] ?? null });
    }
    if (parsed.name === "ChallengeResolved" && args.upheld) this.challengeRewards += fmt(args.reward);
    if (parsed.name === "Reclaimed") this.reclaimed.set(Number(args.lotId), (this.reclaimed.get(Number(args.lotId)) ?? 0) + fmt(args.amount));
    if (parsed.name === "VendorRegistered") this.vendors.set(args.vendor, true);
    this.emit("event", ev);
  }

  async snapshot() {
    const v = this.vault;
    const [nNgos, nLots, nPayouts] = await v.counts();

    const ngos = await Promise.all(
      [...Array(Number(nNgos)).keys()].map(async (id) => {
        const [n, trust] = await Promise.all([v.ngo(id), v.trustScore(id)]);
        return {
          id,
          admin: n.admin,
          name: n.name,
          bond: fmt(n.bond),
          flagCount: Number(n.flagCount),
          payoutsTotal: Number(n.payoutsTotal),
          payoutsCompleted: Number(n.payoutsCompleted),
          challengesLost: Number(n.challengesLost),
          frozen: n.frozen,
          trust: Number(trust),
          profile: db.ngoProfiles[id] ?? null,
        };
      }),
    );

    const lots = await Promise.all(
      [...Array(Number(nLots)).keys()].map(async (id) => {
        const l = await v.lot(id);
        return {
          id,
          donor: l.donor,
          ngoId: Number(l.ngoId),
          category: CATEGORY[Number(l.category)],
          amount: fmt(l.amount),
          remaining: fmt(l.remaining),
          deadline: Number(l.deadline),
          sourceChain: Number(l.sourceChain),
        };
      }),
    );

    const payouts = await Promise.all(
      [...Array(Number(nPayouts)).keys()].map(async (id) => {
        const [p, shares] = await Promise.all([v.payout(id), v.payoutShares(id)]);
        const status = PAYOUT_STATUS[Number(p.status)];
        const ch = await v.challengeOf(id);
        const challenge =
          ch.challenger === ethers.ZeroAddress
            ? null
            : {
                challenger: ch.challenger,
                evidenceHash: ch.evidenceHash,
                evidenceURI: ch.evidenceURI,
                votesUphold: fmt(ch.votesUphold),
                votesReject: fmt(ch.votesReject),
                voteEnd: Number(ch.voteEnd),
                resolved: ch.resolved,
                upheld: ch.upheld,
              };
        return {
          id,
          ngoId: Number(p.ngoId),
          vendor: p.vendor,
          amount: fmt(p.amount),
          paid: fmt(p.paid),
          nullifier: p.nullifier,
          fileHash: p.fileHash,
          file: db.files[p.fileHash] ?? null,
          invoice: Object.values(db.invoices).find((i) => i.fileHash === p.fileHash && i.vendor === p.vendor) ?? null,
          category: CATEGORY[Number(p.category)],
          status,
          releaseAt: Number(p.releaseAt),
          beneficiaryRoot: p.beneficiaryRoot,
          deliveriesRequired: Number(p.deliveriesRequired),
          deliveries: Number(p.deliveries),
          shares: shares.map((s) => ({ lotId: Number(s.lotId), amount: fmt(s.amount) })),
          challenge,
        };
      }),
    );

    const vendors = await Promise.all(
      [...this.vendors.keys()].map(async (addr) => {
        const x = await v.vendors(addr);
        return { address: addr, registered: x.registered, category: CATEGORY[Number(x.category)], nameHash: x.nameHash, stake: fmt(x.stake) };
      }),
    );

    const sum = (arr, f) => arr.reduce((a, x) => a + f(x), 0);
    const stats = {
      tracked: sum(lots, (l) => l.amount),
      inEscrow: sum(lots, (l) => l.remaining) + sum(payouts.filter((p) => !["Cancelled"].includes(p.status)), (p) => p.amount - p.paid),
      paidOut: sum(payouts, (p) => p.paid),
      proofs: payouts.filter((p) => p.status !== "Cancelled").length + sum(payouts, (p) => p.deliveries),
      fraudsCaught: this.flags.length,
      discrepancies: this.discrepancies.length,
      paidToWatchers: this.challengeRewards,
      frozenNgos: ngos.filter((n) => n.frozen).length,
      verifiedPct: payouts.length ? Math.round((100 * payouts.filter((p) => p.status === "Completed").length) / payouts.length) : 0,
    };

    this.state = { ngos, lots, payouts, vendors, flags: this.flags, discrepancies: this.discrepancies, stats, updatedAt: Date.now() };
  }

  /// Sankey data: donor → NGO → category → vendor, link status = verified | pending | flagged | frozen | refunded.
  /// Conserves money per NGO: donated = paid or reserved for vendors + still in escrow + reclaimed by donors.
  flow() {
    const s = this.state;
    if (!s) return { nodes: [], links: [] };
    const nodes = new Map();
    const node = (id, label, kind) => (nodes.has(id) || nodes.set(id, { id, label, kind }), id);
    const links = [];
    const link = (source, target, value, status) => value > 0 && links.push({ source, target, value, status });

    for (const l of s.lots) {
      const ngo = s.ngos[l.ngoId];
      link(node(`donor:${l.donor}`, l.donor, "donor"), node(`ngo:${l.ngoId}`, ngo?.name ?? `NGO ${l.ngoId}`, "ngo"), l.amount, ngo?.frozen ? "frozen" : "verified");
    }
    for (const p of s.payouts) {
      // a Cancelled payout returned its unpaid part to the lots (drawn as escrow / refund below);
      // only what it already paid the vendor left the NGO — before the freeze unwound it
      const value = p.status === "Cancelled" ? p.paid : p.amount;
      const status = p.status === "Cancelled" ? "frozen" : { Completed: "verified", Released: "pending", Pending: "pending", Challenged: "flagged" }[p.status];
      const cat = node(`cat:${p.ngoId}:${p.category}`, p.category, "category");
      link(`ngo:${p.ngoId}`, cat, value, status);
      link(cat, node(`vendor:${p.vendor}`, p.vendor, "vendor"), value, status);
    }
    for (const l of s.lots) {
      if (l.remaining > 0) link(`ngo:${l.ngoId}`, node(`escrow:${l.ngoId}`, "In escrow", "escrow"), l.remaining, s.ngos[l.ngoId]?.frozen ? "frozen" : "pending");
      const back = this.reclaimed.get(l.id) ?? 0;
      if (back > 0) link(`ngo:${l.ngoId}`, node(`refund:${l.ngoId}`, "Refunded to donors", "refund"), back, "refunded");
    }
    return { nodes: [...nodes.values()], links };
  }

  /// Everything about one donation: the lot, the payouts that spent it, and its event trail.
  passport(lotId) {
    const s = this.state;
    const lot = s?.lots[lotId];
    if (!lot) return null;
    const payouts = s.payouts.filter((p) => p.shares.some((sh) => sh.lotId === lotId)).map((p) => ({ ...p, share: p.shares.find((sh) => sh.lotId === lotId).amount }));
    const payoutIds = new Set(payouts.map((p) => String(p.id)));
    // events naming a lot must name THIS lot; otherwise follow the payouts this lot funded
    const trail = this.events.filter((e) =>
      e.args.lotId !== undefined ? Number(e.args.lotId) === lotId : e.args.payoutId !== undefined && payoutIds.has(String(e.args.payoutId)),
    );
    return { lot, ngo: s.ngos[lot.ngoId], payouts, trail };
  }
}
