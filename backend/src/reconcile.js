/// Report Reconciler: compares what an NGO *publishes* against what the chain *recorded*.
///
/// report = {
///   ngoId,
///   categories: [{ category: "Water", spent: 500000 }],             // "we spent ₹5L on water"
///   donorReports: [{ donor: "0x…", invoices: [{ payoutId | nullifier | fileHash, amount }] }]  // per-donor impact reports
/// }
///
/// Finds: category over-claims, invoices that don't exist on-chain, and OVER-ATTRIBUTION —
/// the same invoice told to several donors for more than it was actually charged to each.
export function reconcile(state, report) {
  const ngoId = Number(report.ngoId);
  // every payout counts: a Cancelled one may still have paid its 70% before it was unwound
  const payouts = state.payouts.filter((p) => p.ngoId === ngoId);
  const lots = state.lots;
  // money a payout really moved: an unwound payout returned its unpaid part to the lots
  const spentFrac = (p) => (p.status === "Cancelled" ? p.paid / p.amount : 1);
  const lines = [];

  for (const c of report.categories ?? []) {
    const onChain = payouts.filter((p) => p.category === c.category).reduce((s, p) => s + p.paid, 0);
    const diff = Number(c.spent) - onChain;
    lines.push({
      kind: "category",
      label: `${c.category} spending`,
      claimed: Number(c.spent),
      onChain,
      status: Math.abs(diff) < 1 ? "match" : diff > 0 ? "over-claimed" : "under-claimed",
      detail: diff > 0 ? `Claims ₹${diff.toLocaleString("en-IN")} more than was ever paid out on-chain` : null,
    });
  }

  // invoice → total claimed across all donor reports
  const claimedPerInvoice = new Map();
  for (const r of report.donorReports ?? []) {
    for (const inv of r.invoices ?? []) {
      const p = findPayout(payouts, inv);
      const key = p ? p.id : `missing:${inv.payoutId ?? inv.nullifier ?? inv.fileHash}`;
      if (!p) {
        lines.push({ kind: "invoice", label: `Invoice reported to ${short(r.donor)}`, claimed: Number(inv.amount), onChain: 0, status: "not-on-chain", detail: "No payout on-chain carries this invoice" });
        continue;
      }
      const donorShare = p.shares.filter((s) => lots[s.lotId]?.donor?.toLowerCase() === r.donor.toLowerCase()).reduce((s, x) => s + x.amount, 0) * spentFrac(p);
      if (Number(inv.amount) > donorShare + 0.5) {
        lines.push({
          kind: "attribution",
          label: `Payout #${p.id} reported to ${short(r.donor)}`,
          claimed: Number(inv.amount),
          onChain: donorShare,
          status: "over-attributed",
          detail: donorShare === 0 ? "This donor's money never funded this invoice" : `Donor actually funded ₹${donorShare.toLocaleString("en-IN")} of it`,
        });
      }
      const agg = claimedPerInvoice.get(key) ?? { payout: p, total: 0, donors: [] };
      agg.total += Number(inv.amount);
      agg.donors.push(r.donor);
      claimedPerInvoice.set(key, agg);
    }
  }

  for (const { payout, total, donors } of claimedPerInvoice.values()) {
    const real = payout.amount * spentFrac(payout);
    if (total > real + 0.5) {
      lines.push({
        kind: "double-count",
        label: `Payout #${payout.id} counted in ${donors.length} donor reports`,
        claimed: total,
        onChain: real,
        status: "double-counted",
        detail: `₹${real.toLocaleString("en-IN")} of real spend reported as ₹${total.toLocaleString("en-IN")} of impact (${real ? Math.round((100 * total) / real) : "∞"}%)`,
      });
    }
  }

  const problems = lines.filter((l) => !["match", "under-claimed"].includes(l.status));
  return { ngoId, lines, problems: problems.length, verdict: problems.length ? "inconsistent" : "consistent" };
}

/// Exact match by payout id or nullifier (both unique on-chain). A file hash is only trusted when it
/// points at exactly one payout — the same file can back several payouts.
function findPayout(payouts, inv) {
  if (inv.payoutId !== undefined && inv.payoutId !== null && inv.payoutId !== "") return payouts.find((x) => x.id === Number(inv.payoutId)) ?? null;
  if (inv.nullifier) return payouts.find((x) => x.nullifier.toLowerCase() === String(inv.nullifier).toLowerCase()) ?? null;
  const byFile = inv.fileHash ? payouts.filter((x) => x.fileHash === inv.fileHash) : [];
  return byFile.length === 1 ? byFile[0] : null;
}

const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;
