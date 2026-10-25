import { ethers } from "ethers";
import { db, save, putFile, hamming } from "./store.js";

const NEAR_DUPLICATE_BITS = 14; // dHash distance ≤ 14 of 256 = same receipt image (re-scan, crop, re-compress)
const BENFORD_MIN_SAMPLES = 15;
const BENFORD = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => Math.log10(1 + 1 / d));

/// Open-source watcher bot. It holds no special power: it uses the same public `challenge()` any
/// citizen can call, posting its own bond. The donors' vote decides; the bot only brings evidence.
export class Watcher {
  constructor({ indexer, depA, providerA, key, broadcast }) {
    this.indexer = indexer;
    this.wallet = new ethers.Wallet(key, providerA);
    this.vault = new ethers.Contract(depA.GlassVault.address, depA.GlassVault.abi, this.wallet);
    this.token = new ethers.Contract(depA.DINR.address, depA.DINR.abi, this.wallet);
    this.broadcast = broadcast;
    this.seen = new Set();
    this.findings = db.watcherFindings; // persisted across restarts
    this.queue = Promise.resolve();
  }

  start() {
    const handle = (ev) => {
      if (ev.name !== "PayoutRequested" || this.seen.has(ev.id)) return;
      this.seen.add(ev.id);
      // serialize so nonces never collide
      this.queue = this.queue.then(() => this.inspect(ev)).catch((e) => console.error("[watcher]", e.shortMessage || e.message));
    };
    // follow live first, then catch up on payouts requested while the bot was offline whose
    // challenge window is still open (`seen` dedupes anything that arrives both ways)
    this.indexer.on("event", handle);
    this.wallet.provider
      .getBlock("latest")
      .then((b) => this.indexer.events.filter((ev) => ev.name === "PayoutRequested" && Number(ev.args.releaseAt) > b.timestamp).forEach(handle))
      .catch((e) => console.error("[watcher] catch-up", e.shortMessage || e.message));
  }

  async inspect(ev) {
    const payoutId = Number(ev.args.payoutId);
    // already challenged / released (e.g. by a citizen while we were offline) — nothing to add
    const current = this.indexer.state?.payouts?.[payoutId];
    if (current && current.status !== "Pending") return;
    const releaseAt = Number(ev.args.releaseAt);
    const now = (await this.wallet.provider.getBlock("latest")).timestamp; // chain clock, not wall clock
    const evidence = [];

    // 1. near-duplicate receipt image under a DIFFERENT invoice (nullifier differs, image is the same)
    const file = db.files[ev.args.fileHash];
    if (file?.dhash) {
      for (const other of this.indexer.state?.payouts ?? []) {
        if (other.id === payoutId || other.nullifier === ev.args.nullifier) continue;
        const of = db.files[other.fileHash];
        if (!of?.dhash) continue;
        const d = hamming(file.dhash, of.dhash);
        if (d <= NEAR_DUPLICATE_BITS) {
          evidence.push({ check: "near-duplicate-receipt", detail: `Receipt image matches payout #${other.id} (dHash distance ${d}/256) but claims a different invoice`, matchPayout: other.id, distance: d });
          break;
        }
      }
    }

    // 2. impossible timeline — invoice dated in the future. The contract now rejects these on-chain
    //    (ImpossibleTimeline flag); this check stays as evidence for deployments without that rule.
    const invoice = Object.values(db.invoices).find((i) => i.fileHash === ev.args.fileHash && i.vendor === ev.args.vendor);
    if (invoice && invoice.date > now + 86400) {
      evidence.push({ check: "future-dated-invoice", detail: `Invoice dated ${new Date(invoice.date * 1000).toISOString().slice(0, 10)} is in the future` });
    }

    // 3. Benford's-law drift on this NGO's invoice amounts (signal only — published, never auto-challenged)
    const ngoId = Number(ev.args.ngoId);
    const benford = this.benford(ngoId);
    if (benford) this.publish({ kind: "benford", ngoId, ...benford });

    if (!evidence.length) return;

    const finding = { kind: "challenge", payoutId, ngoId, evidence, at: Date.now() };
    if (now >= releaseAt) {
      this.publish({ ...finding, skipped: "challenge window already closed" });
      return;
    }

    // publish evidence content-addressed, then challenge on-chain with our own bond
    const blob = Buffer.from(JSON.stringify({ payoutId, evidence, watcher: this.wallet.address, at: new Date().toISOString() }, null, 2));
    const stored = await putFile(blob, { name: `evidence-payout-${payoutId}.json`, mime: "application/json" });
    const bond = await this.vault.CHALLENGE_BOND();
    if ((await this.token.allowance(this.wallet.address, this.vault.target)) < bond) {
      await (await this.token.approve(this.vault.target, ethers.MaxUint256)).wait();
    }
    const tx = await this.vault.challenge(payoutId, stored.fileHash, `ipfs://${stored.cid}`);
    await tx.wait();
    this.publish({ ...finding, tx: tx.hash, evidenceURI: `ipfs://${stored.cid}` });
  }

  /// Mean absolute deviation of first-digit frequencies from Benford's law (Nigrini's thresholds).
  benford(ngoId) {
    const amounts = (this.indexer.state?.payouts ?? []).filter((p) => p.ngoId === ngoId).map((p) => p.amount);
    if (amounts.length < BENFORD_MIN_SAMPLES) return null;
    const counts = Array(9).fill(0);
    for (const a of amounts) {
      const d = Number(String(Math.floor(a)).replace(/^0+/, "")[0]);
      if (d >= 1 && d <= 9) counts[d - 1]++;
    }
    const n = counts.reduce((a, b) => a + b, 0);
    const observed = counts.map((c) => c / n);
    const mad = observed.reduce((s, o, i) => s + Math.abs(o - BENFORD[i]), 0) / 9;
    const verdict = mad < 0.006 ? "close" : mad < 0.012 ? "acceptable" : mad < 0.015 ? "marginal" : "nonconforming";
    return { samples: n, mad: Number(mad.toFixed(4)), verdict, observed, expected: BENFORD };
  }

  publish(finding) {
    this.findings.unshift(finding);
    this.findings = db.watcherFindings = this.findings.slice(0, 200);
    save();
    this.broadcast("watcher", finding);
  }
}
