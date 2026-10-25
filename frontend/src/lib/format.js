// Money formatting — one place, one convention: ₹ always BEFORE the number, Indian digit grouping.
const grouped = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

/// ₹40,000 · ₹1,15,000
export const inr = (v) => `₹${grouped.format(v ?? 0)}`;

const UNITS = { Cr: 1e7, L: 1e5 };

/// Unit that reads best for the largest value in a group, so one row of KPIs never mixes units.
export const inrUnitFor = (...values) => {
  const max = Math.max(0, ...values.map((v) => v ?? 0));
  return max >= 1e7 ? "Cr" : max >= 1e5 ? "L" : null;
};

/// Compact rupees split into number + unit for big KPI displays:
///   (3_00_000) → { value: "₹3.0", unit: "L" } · (40_000) → { value: "₹40,000", unit: null }
///   (40_000, "L") → { value: "₹0.4", unit: "L" }  — forced unit keeps a row consistent
export function inrCompact(v, unit = inrUnitFor(v)) {
  if (!unit) return { value: inr(v), unit: null };
  const n = (v ?? 0) / UNITS[unit];
  return { value: `₹${n.toFixed(n >= 100 ? 0 : unit === "Cr" ? 2 : 1)}`, unit };
}

/// Probability 0..1 → "94%" (null/undefined → "—").
export const pct = (p) => (p == null || Number.isNaN(Number(p)) ? "—" : `${Math.round(Number(p) * 100)}%`);
