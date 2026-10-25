import { REASONS } from "../watch/shared";

/// Money pipeline across the platform: donated → held → released → impact-verified.
export function pipeline(state) {
  const s = state.stats;
  const verified = state.payouts.filter((p) => p.status === "Completed").reduce((a, p) => a + p.amount, 0);
  return [
    { label: "Donated", sub: "tagged lots, all chains", value: s.tracked, tone: "soft" },
    { label: "Held in escrow", sub: "no person can move it", value: s.inEscrow, tone: "pending" },
    { label: "Released to vendors", sub: "against signed invoices", value: s.paidOut, tone: "signal" },
    { label: "Impact verified", sub: "beneficiaries confirmed", value: verified, tone: "deep" },
  ];
}

/// Fraud caught, by reason (counted flags, black + hatch) plus discrepancies (recorded, not counted).
export function fraudByReason(state) {
  const counts = new Map();
  for (const f of state.flags) counts.set(f.reason, (counts.get(f.reason) ?? 0) + 1);
  const bars = [...counts.entries()]
    .map(([reason, value]) => ({ key: reason, label: REASONS[reason]?.title ?? reason, value, tone: "bad" }))
    .sort((a, b) => b.value - a.value);
  const disc = state.discrepancies?.length ?? 0;
  if (disc) bars.push({ key: "discrepancies", label: "Discrepancies (not counted)", value: disc, tone: "pending" });
  return bars;
}

/// Cumulative fraud flags over chain time.
export function flagsOverTime(state) {
  const sorted = [...state.flags].filter((f) => f.time).sort((a, b) => a.time - b.time);
  return sorted.map((f, i) => ({ t: f.time, v: i + 1, text: REASONS[f.reason]?.title ?? f.reason }));
}
