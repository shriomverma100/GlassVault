/// Report Reconciler: compares what an NGO *publishes* against what the chain *recorded*.
///
/// report = {
///   ngoId,
///   categories: [{ category: "Water", spent: 500000 }],             // "we spent ₹5L on water"
///   donorReports: [{ donor: "0x…", invoices: [{ fileHash | nullifier, amount }] }]  // per-donor impact reports
/// }
///
/// Finds: category over-claims, invoices that don't exist on-chain, and OVER-ATTRIBUTION —
/// the same invoice told to several donors for more than it was actually charged to each.
export function reconcile(state, report) {
  const ngoId = Number(report.ngoId);
  const payouts = state.payouts.filter((p) => p.ngoId === ngoId && p.status !== "Cancelled");
  const lots = state.lots;
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
      const p = payouts.find((x) => x.fileHash === inv.fileHash || x.nullifier === inv.nullifier);
      const key = p ? p.id : `missing:${inv.fileHash ?? inv.nullifier}`;
      if (!p) {
        lines.push({ kind: "invoice", label: `Invoice reported to ${short(r.donor)}`, claimed: Number(inv.amount), onChain: 0, status: "not-on-chain", detail: "No payout on-chain carries this invoice" });
        continue;
      }
      const donorShare = p.shares.filter((s) => lots[s.lotId]?.donor?.toLowerCase() === r.donor.toLowerCase()).reduce((s, x) => s + x.amount, 0);
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
    if (total > payout.amount + 0.5) {
      lines.push({
        kind: "double-count",
        label: `Payout #${payout.id} counted in ${donors.length} donor reports`,
        claimed: total,
        onChain: payout.amount,
        status: "double-counted",
        detail: `₹${payout.amount.toLocaleString("en-IN")} invoice reported as ₹${total.toLocaleString("en-IN")} of impact (${Math.round((100 * total) / payout.amount)}%)`,
      });
    }
  }

  const problems = lines.filter((l) => !["match", "under-claimed"].includes(l.status));
  return { ngoId, lines, problems: problems.length, verdict: problems.length ? "inconsistent" : "consistent" };
}

const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;
