import { useReducedMotion } from "framer-motion";
import { VaultIcon, InvoiceIcon, QrIcon, EyeIcon, ShieldCheckIcon } from "../icons";

// The landing page's "how a rupee moves" as a flow diagram: four steps joined by structure lines,
// with dots (rupees) travelling from donor to beneficiary. Geometry lives in one 1200×340 box; the
// HTML labels sit on top at the same percentages, so they line up at every width.
const W = 1200;
const H = 340;
const NODES = [
  { x: 110, y: 170, n: "01", title: "Donate with a purpose", icon: <VaultIcon />, stat: "tracked" },
  { x: 430, y: 130, n: "02", title: "Locked in escrow", icon: <ShieldCheckIcon />, stat: "inEscrow", hold: true },
  { x: 770, y: 180, n: "03", title: "Signed invoice → 70%", icon: <InvoiceIcon />, stat: "paidOut" },
  { x: 1090, y: 140, n: "04", title: "Beneficiaries' cards → 30%", icon: <QrIcon />, stat: "proofs", last: true },
];
const STAT_LABEL = { tracked: "donated", inEscrow: "in escrow now", paidOut: "paid to vendors", proofs: "deliveries proven" };
const TEXT = {
  "01": "Your gift becomes a tagged lot: Water, Medical or Education, with a deadline.",
  "02": "A smart contract holds it. No person — not the NGO, not us — can move it.",
  "03": "A staked vendor signs the bill. After a public challenge window, 70% is released.",
  "04": "People confirm delivery with QR cards. Only then is the last 30% paid.",
};

const curve = (a, b) => {
  const mx = (a.x + b.x) / 2;
  return `M${a.x} ${a.y} C${mx} ${a.y}, ${mx} ${b.y}, ${b.x} ${b.y}`;
};
const LINKS = NODES.slice(1).map((b, i) => curve(NODES[i], b));
const PATH = `M${NODES[0].x} ${NODES[0].y} ` + LINKS.map((d) => d.replace(/^M[^C]+/, "")).join(" ");

export default function FlowDiagram({ stats, format }) {
  const still = useReducedMotion();
  const value = (k) => (k === "proofs" ? String(stats.proofs ?? 0) : format(stats[k] ?? 0));
  return (
    <>
      {/* wide screens: the diagram */}
      <div className="relative hidden aspect-[1200/340] w-full xl:block">
        <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 h-full w-full overflow-visible" aria-hidden="true">
          {/* the watcher's structure line into the challenge window */}
          <line x1="600" y1="30" x2="600" y2="150" stroke="var(--color-hairline)" strokeWidth="1.5" strokeDasharray="3 6" />
          {/* connectors: a calm base line and a moving dash on top */}
          <path d={PATH} fill="none" stroke="var(--color-hairline)" strokeWidth="2" />
          {LINKS.map((d, i) => (
            <path key={i} d={d} fill="none" stroke="var(--color-graphite)" strokeOpacity="0.55" strokeWidth="2" className={still ? "" : "flow-dash"} style={{ animationDelay: `${-i * 0.45}s` }} />
          ))}
          {/* rupees moving downstream */}
          {!still &&
            [0, 1, 2].map((k) => (
              <circle key={k} r="4.5" fill="var(--color-signal-deep)">
                <animateMotion dur="7s" begin={`${-k * 2.33}s`} repeatCount="indefinite" path={PATH} />
              </circle>
            ))}
          {NODES.map((p) => (
            <g key={p.n}>
              {p.hold && !still && <circle cx={p.x} cy={p.y} r="34" fill="none" stroke="var(--color-signal-deep)" strokeWidth="2" className="breathe" />}
              <circle cx={p.x} cy={p.y} r="30" fill={p.hold ? "var(--color-charcoal)" : "var(--color-white)"} stroke={p.last ? "var(--color-signal-deep)" : "var(--color-hairline)"} strokeWidth="1.5" />
            </g>
          ))}
        </svg>

        <div className="absolute flex -translate-x-1/2 items-center gap-2 rounded-full border border-hairline bg-white px-3 py-1.5 text-[12px] text-ash" style={{ left: "50%", top: 0 }}>
          <EyeIcon size={14} /> Watchers can challenge any payout in the window
        </div>

        {NODES.map((p) => (
          <div key={p.n} className="absolute" style={{ left: `${(p.x / W) * 100}%`, top: `${(p.y / H) * 100}%` }}>
            <span className={`absolute grid h-[60px] w-[60px] -translate-x-1/2 -translate-y-1/2 place-items-center ${p.hold ? "text-white" : "text-obsidian"}`}>{p.icon}</span>
            <div className="group absolute top-11 w-[220px] -translate-x-1/2 rounded-[var(--radius-tile)] border border-hairline bg-white p-3.5 transition-[border-color,box-shadow] hover:border-ash/40 hover:shadow-[0_12px_32px_-20px_rgb(18_18_18/0.35)]">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-mono text-[12px] text-graphite">{p.n}</span>
                <span className="text-[12px] text-graphite">
                  <b className="font-display text-[16px] font-medium text-obsidian tabular">{value(p.stat)}</b> {STAT_LABEL[p.stat]}
                </span>
              </div>
              <div className="mt-1 text-[15px] leading-snug font-medium">{p.title}</div>
              <p className="mt-1 text-[13px] leading-snug text-ash">{TEXT[p.n]}</p>
            </div>
          </div>
        ))}
      </div>

      {/* narrower screens: the same steps as a vertical timeline */}
      <ol className="relative flex flex-col gap-3 pl-8 xl:hidden">
        <span aria-hidden="true" className="absolute top-3 bottom-3 left-[13px] w-[2px] rounded-full bg-hairline" />
        {NODES.map((p) => (
          <li key={p.n} className={`relative rounded-[var(--radius-tile)] border p-4 ${p.last ? "border-signal-deep bg-signal-mist" : "border-hairline bg-white"}`}>
            <span aria-hidden="true" className={`absolute top-5 -left-[27px] h-3.5 w-3.5 rounded-full border-2 border-bone ${p.hold ? "bg-charcoal" : "bg-signal-deep"}`} />
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-mono text-[12px] text-graphite">{p.n}</span>
              <span className="text-[12px] text-graphite">
                <b className="text-obsidian tabular">{value(p.stat)}</b> {STAT_LABEL[p.stat]}
              </span>
            </div>
            <div className="mt-1 text-[15px] font-medium">{p.title}</div>
            <p className="mt-1 text-[13px] leading-snug text-ash">{TEXT[p.n]}</p>
          </li>
        ))}
      </ol>
    </>
  );
}
