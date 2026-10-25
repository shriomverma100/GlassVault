import { pct } from "../lib/format";
import { CheckIcon, CrossIcon, HourglassIcon, ScaleIcon } from "./icons";
import { Card } from "./ui/kit";

// Status = fill + pattern + icon (never colour alone): proven = yellow, failed = black hatch,
// pending = dashed outline, not reached = plain hairline.
const LOOK = {
  proven: { card: "border-signal-deep bg-signal-mist", icon: <CheckIcon size={16} />, text: "Proven" },
  failed: { card: "hatch border-obsidian bg-obsidian text-white", icon: <CrossIcon size={16} />, text: "Failed" },
  pending: { card: "border-dashed border-ash/50 bg-white", icon: <HourglassIcon size={16} />, text: "Pending" },
  "n/a": { card: "border-hairline bg-paper", icon: <HourglassIcon size={16} />, text: "Not reached yet" },
};

const fmt = (p) => Number(p).toFixed(2);

/// The PS's "Probabilistic Evaluation Chain" for one lot: Inbound Donation → Escrow Condition →
/// Cryptographic Impact Verification → Off-Chain Invoice Proof, each with a probability from evidence.
export default function ConfidenceChain({ confidence, lotId }) {
  if (!confidence?.stages?.length) return null;
  const reached = confidence.stages.filter((s) => s.p != null);
  const product = reached.reduce((a, s) => a * s.p, 1);
  return (
    <div>
      <ol className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        {confidence.stages.map((s, i) => {
          const look = s.p == null ? LOOK["n/a"] : (LOOK[s.status] ?? LOOK["n/a"]);
          const dark = s.status === "failed" && s.p != null;
          return (
            <li key={s.key}>
              <Card className={`flex h-full flex-col gap-3 p-5 ${look.card}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className={`text-[13px] font-medium ${dark ? "text-white/80" : "text-ash"}`}>
                    {String(i + 1).padStart(2, "0")} · {s.label}
                  </span>
                  <span className={`flex items-center gap-1.5 text-[13px] ${dark ? "text-white" : "text-obsidian"}`}>
                    {look.icon}
                    {s.p == null ? LOOK["n/a"].text : look.text}
                  </span>
                </div>
                <div className="font-display text-[40px] leading-none font-normal tabular">{pct(s.p)}</div>
                {s.factors?.length > 0 && (
                  <ul className={`flex flex-col gap-1 text-[13px] ${dark ? "text-white/80" : "text-ash"}`}>
                    {s.factors.map((f) => (
                      <li key={f.text}>
                        <span className="font-mono tabular">× {fmt(f.weight)}</span> · {f.text}
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </li>
          );
        })}
      </ol>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-4 rounded-[var(--radius-tile)] border border-hairline bg-white px-6 py-4">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-[15px] font-medium">Chain confidence {fmt(confidence.score)}</span>
          <span className="font-mono text-[13px] text-ash tabular">= {reached.length ? reached.map((s) => fmt(s.p)).join(" × ") : "1.00"}</span>
          {Math.abs(product - confidence.score) > 0.005 && <span className="text-[13px] text-ash">(weighted by money spent)</span>}
          {confidence.provisional && <span className="rounded-full border border-dashed border-ash/50 px-2.5 py-0.5 text-[13px] text-ash">provisional — some stages still pending</span>}
        </div>
        <a href={`/api/confidence/${lotId}`} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-[14px] font-medium underline underline-offset-4">
          <ScaleIcon size={16} /> Re-run this calculation
        </a>
      </div>
      <p className="mt-3 text-[13px] text-ash">
        Each hop's probability comes from on-chain evidence and open watcher signals; the score is informational — only contract rules move or freeze money.
      </p>
    </div>
  );
}
