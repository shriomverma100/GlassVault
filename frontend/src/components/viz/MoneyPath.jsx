import { inr } from "../../lib/format";

/// "Where your ₹X goes" — the escrow rules as a path diagram, live with the donor's choices.
export default function MoneyPath({ amount, ngoName, category, fallbackName }) {
  const a = Math.max(0, Number(amount) || 0);
  const W = 352;
  const box = (y, h, text, sub, tone = "white") => (
    <g transform={`translate(0 ${y})`}>
      <rect
        x="0.5"
        y="0.5"
        width={W - 1}
        height={h}
        rx="14"
        fill={tone === "signal" ? "var(--color-signal)" : tone === "mist" ? "var(--color-signal-mist)" : "var(--color-white)"}
        stroke={tone === "dashed" ? "var(--color-obsidian)" : "var(--color-hairline)"}
        strokeDasharray={tone === "dashed" ? "4 3" : undefined}
      />
      <text x="16" y="24" className="fill-obsidian text-[14px] font-medium">
        {text}
      </text>
      {sub && (
        <text x="16" y="44" className="fill-ash text-[12px]">
          {sub}
        </text>
      )}
    </g>
  );
  const link = (y0, y1, x = 28) => <path d={`M ${x} ${y0} V ${y1}`} stroke="var(--color-obsidian)" strokeWidth="1.5" markerEnd="url(#mp-arrow)" fill="none" />;
  return (
    <svg viewBox={`0 0 ${W} 360`} className="w-full" role="img" aria-label={`Where ${inr(a)} goes`}>
      <defs>
        <marker id="mp-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M0 0 L8 4 L0 8 z" fill="var(--color-obsidian)" />
        </marker>
      </defs>
      {box(0, 56, `You give ${inr(a)}`, `tagged: ${category} · ${ngoName ?? "an NGO"}`, "signal")}
      {link(57, 78)}
      {box(80, 56, "Locked in escrow", "no person — not even us — can move it", "mist")}
      {link(137, 158)}
      {box(160, 56, `70% · ${inr(Math.round(a * 0.7))} to a vendor`, "only on an invoice the vendor signed")}
      {link(217, 238)}
      {box(240, 56, `30% · ${inr(a - Math.round(a * 0.7))} after delivery`, "beneficiaries' cards confirm the handover")}
      {link(297, 302)}
      {box(304, 52, fallbackName ? `Unspent → ${fallbackName}` : "Unspent → back to you", "if the NGO is frozen or misses the deadline", "dashed")}
    </svg>
  );
}
