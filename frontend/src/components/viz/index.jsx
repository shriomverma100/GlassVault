import { useEffect, useId, useRef, useState } from "react";

// Chart primitives — pure SVG, white/black/yellow tokens only (CLAUDE.md). Identity never rides on colour
// alone: every mark is direct-labelled, negative states are black + hatch, pending is a dashed outline.
// Each chart has a hover state (highlight + value readout) and respects prefers-reduced-motion.

/// Mark tones → fill/stroke. "bad" adds the hatch overlay via <Hatch/>.
export const TONE = {
  signal: { fill: "var(--color-signal)", stroke: "none" },
  deep: { fill: "var(--color-signal-deep)", stroke: "none" },
  soft: { fill: "var(--color-signal-soft)", stroke: "none" },
  neutral: { fill: "var(--color-ash)", stroke: "none" },
  pending: { fill: "var(--color-white)", stroke: "var(--color-obsidian)", dash: "4 3" },
  bad: { fill: "var(--color-obsidian)", stroke: "none", hatch: true },
};

const reduced = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

function Hatch({ id }) {
  return (
    <pattern id={id} patternUnits="userSpaceOnUse" width="7" height="7" patternTransform="rotate(45)">
      <line x1="0" y1="0" x2="0" y2="7" stroke="var(--color-white)" strokeOpacity="0.35" strokeWidth="1.5" />
    </pattern>
  );
}

/// A rectangle in a given tone (with hatch overlay for "bad", dashed outline for "pending").
function Mark({ tone = "signal", hatchId, ...r }) {
  const t = TONE[tone] ?? TONE.signal;
  return (
    <g>
      <rect {...r} fill={t.fill} stroke={t.stroke} strokeWidth={t.stroke === "none" ? 0 : 1} strokeDasharray={t.dash} />
      {t.hatch && <rect {...r} fill={`url(#${hatchId})`} />}
    </g>
  );
}

/// Legend swatch matching a tone.
export function Swatch({ tone = "signal" }) {
  const id = `sw-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  return (
    <svg width="14" height="14" aria-hidden="true" className="shrink-0">
      <defs>
        <Hatch id={id} />
      </defs>
      <Mark tone={tone} hatchId={id} x="0.5" y="0.5" width="13" height="13" rx="3" />
    </svg>
  );
}

/// Number that counts up to `value` (≤600ms); instant with reduced motion.
export function CountUp({ value, format = (v) => Math.round(v).toLocaleString("en-IN"), duration = 600 }) {
  const [shown, setShown] = useState(value);
  const from = useRef(0);
  useEffect(() => {
    if (reduced() || typeof value !== "number") return setShown(value);
    const start = performance.now();
    const a = from.current;
    let id;
    const tick = (t) => {
      const k = Math.min(1, (t - start) / duration);
      const eased = 1 - Math.pow(1 - k, 3);
      setShown(a + (value - a) * eased);
      if (k < 1) id = requestAnimationFrame(tick);
      else from.current = value;
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [value, duration]);
  return <>{typeof shown === "number" ? format(shown) : shown}</>;
}

/// Horizontal bars, one series, direct-labelled; hover highlights a bar.
export function HBars({ data, format = (v) => v, empty = "Nothing yet", width = 520 }) {
  const hatchId = `hb-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const [hover, setHover] = useState(null);
  if (!data.length) return <div className="py-6 text-[14px] text-ash">{empty}</div>;
  const max = Math.max(1, ...data.map((d) => d.value));
  const row = 30;
  const labelW = 190;
  const valueW = 70;
  const barW = width - labelW - valueW;
  return (
    <svg viewBox={`0 0 ${width} ${data.length * row}`} className="w-full" role="img" aria-label={data.map((d) => `${d.label}: ${format(d.value)}`).join(", ")}>
      <defs>
        <Hatch id={hatchId} />
      </defs>
      {data.map((d, i) => {
        const w = Math.max(4, (d.value / max) * barW);
        const dim = hover !== null && hover !== i;
        return (
          <g key={d.key ?? d.label} transform={`translate(0 ${i * row})`} opacity={dim ? 0.35 : 1} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} style={{ transition: "opacity 120ms" }}>
            <rect x="0" y="0" width={width} height={row} fill="transparent" />
            <text x="0" y={row / 2} dy="0.35em" className="fill-obsidian text-[13px]">
              {d.label}
            </text>
            <Mark tone={d.tone} hatchId={hatchId} x={labelW} y={7} width={w} height={row - 14} rx="4" />
            <text x={labelW + w + 8} y={row / 2} dy="0.35em" className="fill-ash text-[13px] font-medium tabular">
              {format(d.value)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/// Funnel: each stage as a bar sized against the first stage, with its share of it.
export function Funnel({ steps, format = (v) => v }) {
  const [hover, setHover] = useState(null);
  const top = Math.max(1, steps[0]?.value ?? 1);
  return (
    <div className="flex flex-col gap-2" role="list">
      {steps.map((s, i) => {
        const share = s.value / top;
        return (
          <div
            key={s.label}
            role="listitem"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
            className={`grid grid-cols-[180px_1fr_120px] items-center gap-4 transition-opacity ${hover !== null && hover !== i ? "opacity-40" : ""}`}
          >
            <div>
              <div className="text-[14px] font-medium">{s.label}</div>
              {s.sub && <div className="text-[12px] text-graphite">{s.sub}</div>}
            </div>
            <div className="relative h-9 rounded-[6px] bg-bone">
              <div
                className={`absolute inset-y-0 left-0 rounded-[6px] ${s.tone === "pending" ? "border border-dashed border-obsidian bg-white" : s.tone === "soft" ? "bg-signal-soft" : s.tone === "deep" ? "bg-signal-deep" : "bg-signal"}`}
                style={{ width: `${Math.max(1.5, share * 100)}%`, transition: reduced() ? "none" : "width 500ms cubic-bezier(.2,0,0,1)" }}
              />
              <span className="absolute inset-y-0 right-3 flex items-center text-[12px] font-medium text-ash tabular">{Math.round(share * 100)}%</span>
            </div>
            <div className="text-right font-display text-[20px] tabular">{format(s.value)}</div>
          </div>
        );
      })}
    </div>
  );
}

const arc = (cx, cy, r, a0, a1) => {
  const p = (a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  const [x0, y0] = p(a0);
  const [x1, y1] = p(a1);
  return `M ${x0} ${y0} A ${r} ${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${x1} ${y1}`;
};

/// Donut with direct-labelled legend; hover shows the part in the centre.
export function Donut({ parts, format = (v) => v, size = 180, center }) {
  const hatchId = `dn-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const [hover, setHover] = useState(null);
  const total = parts.reduce((a, p) => a + p.value, 0);
  const r = size / 2 - 14;
  const c = size / 2;
  let a = -Math.PI / 2;
  const gap = parts.filter((p) => p.value > 0).length > 1 ? 0.03 : 0;
  const shown = hover !== null ? parts[hover] : null;
  return (
    <div className="flex flex-wrap items-center gap-6">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={parts.map((p) => `${p.label}: ${format(p.value)}`).join(", ")}>
        <defs>
          <Hatch id={hatchId} />
        </defs>
        <circle cx={c} cy={c} r={r} fill="none" stroke="var(--color-bone)" strokeWidth="22" />
        {total > 0 &&
          parts.map((p, i) => {
            if (p.value <= 0) return null;
            const sweep = (p.value / total) * Math.PI * 2;
            const a0 = a + gap / 2;
            const a1 = a + Math.max(sweep - gap / 2, gap / 2 + 0.001);
            a += sweep;
            const t = TONE[p.tone] ?? TONE.signal;
            const d = sweep >= Math.PI * 2 - 0.001 ? null : arc(c, c, r, a0, a1);
            const common = { fill: "none", strokeWidth: hover === i ? 26 : 22, onMouseEnter: () => setHover(i), onMouseLeave: () => setHover(null), style: { transition: "stroke-width 120ms" } };
            return (
              <g key={p.label}>
                {d ? <path d={d} stroke={t.stroke !== "none" ? "var(--color-hairline)" : t.fill} {...common} /> : <circle cx={c} cy={c} r={r} stroke={t.fill} {...common} />}
                {t.hatch && d && <path d={d} stroke={`url(#${hatchId})`} {...common} />}
              </g>
            );
          })}
        <text x={c} y={c - 6} textAnchor="middle" className="fill-obsidian font-display text-[20px] tabular">
          {shown ? format(shown.value) : center?.value ?? format(total)}
        </text>
        <text x={c} y={c + 14} textAnchor="middle" className="fill-ash text-[12px]">
          {shown ? shown.label : center?.label ?? "total"}
        </text>
      </svg>
      <ul className="flex flex-col gap-2 text-[14px]">
        {parts.map((p, i) => (
          <li key={p.label} className="flex items-center gap-2" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <Swatch tone={p.tone} />
            <span>{p.label}</span>
            <span className="ml-2 font-medium tabular text-ash">{format(p.value)}</span>
            {total > 0 && <span className="text-[12px] text-graphite tabular">{Math.round((100 * p.value) / total)}%</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

/// Semicircle gauge 0..100 (trust score).
export function Gauge({ value, label = "Trust score", bad = false, size = 200 }) {
  const hatchId = `gg-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const r = size / 2 - 14;
  const c = size / 2;
  const v = Math.max(0, Math.min(100, value ?? 0));
  const end = Math.PI + (v / 100) * Math.PI;
  return (
    <svg width={size} height={size / 2 + 26} viewBox={`0 0 ${size} ${size / 2 + 26}`} role="img" aria-label={`${label}: ${v} of 100`}>
      <defs>
        <Hatch id={hatchId} />
      </defs>
      <path d={arc(c, c, r, Math.PI, 2 * Math.PI - 0.0001)} fill="none" stroke="var(--color-bone)" strokeWidth="16" strokeLinecap="round" />
      {v > 0 && (
        <>
          <path d={arc(c, c, r, Math.PI, end)} fill="none" stroke={bad ? "var(--color-obsidian)" : "var(--color-signal-deep)"} strokeWidth="16" strokeLinecap="round" />
          {bad && <path d={arc(c, c, r, Math.PI, end)} fill="none" stroke={`url(#${hatchId})`} strokeWidth="16" strokeLinecap="round" />}
        </>
      )}
      <text x={c} y={c - 4} textAnchor="middle" className="fill-obsidian font-display text-[36px] tabular">
        {v}
      </text>
      <text x={c} y={c + 18} textAnchor="middle" className="fill-ash text-[12px]">
        {label} / 100
      </text>
    </svg>
  );
}

/// Progress ring (e.g. deliveries confirmed / required).
export function Ring({ value, max, label, size = 92 }) {
  const r = size / 2 - 8;
  const c = size / 2;
  const k = max ? Math.min(1, value / max) : 0;
  const len = 2 * Math.PI * r;
  return (
    <div className="flex flex-col items-center gap-1.5">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${label}: ${value} of ${max}`}>
        <circle cx={c} cy={c} r={r} fill="none" stroke="var(--color-bone)" strokeWidth="8" />
        <circle
          cx={c}
          cy={c}
          r={r}
          fill="none"
          stroke="var(--color-signal-deep)"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={`${len * k} ${len}`}
          transform={`rotate(-90 ${c} ${c})`}
          style={{ transition: reduced() ? "none" : "stroke-dasharray 500ms cubic-bezier(.2,0,0,1)" }}
        />
        <text x={c} y={c} dy="0.35em" textAnchor="middle" className="fill-obsidian font-display text-[18px] tabular">
          {value}/{max}
        </text>
      </svg>
      <span className="text-[13px] text-ash">{label}</span>
    </div>
  );
}

/// One stacked horizontal bar with a legend (parts sum to the whole); 2px gaps between segments.
export function StackBar({ parts, format = (v) => v, height = 22 }) {
  const hatchId = `sb-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const [hover, setHover] = useState(null);
  const total = parts.reduce((a, p) => a + p.value, 0);
  const W = 600;
  let x = 0;
  const visible = parts.filter((p) => p.value > 0);
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${height}`} className="w-full" preserveAspectRatio="none" role="img" aria-label={parts.map((p) => `${p.label}: ${format(p.value)}`).join(", ")}>
        <defs>
          <Hatch id={hatchId} />
        </defs>
        <rect x="0" y="0" width={W} height={height} rx="5" fill="var(--color-bone)" />
        {total > 0 &&
          visible.map((p) => {
            const w = (p.value / total) * W;
            const gap = visible.length > 1 ? 2 : 0;
            const i = parts.indexOf(p);
            const el = (
              <g key={p.label} opacity={hover !== null && hover !== i ? 0.35 : 1} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                <Mark tone={p.tone} hatchId={hatchId} x={x} y={0} width={Math.max(1, w - gap)} height={height} rx="4" />
              </g>
            );
            x += w;
            return el;
          })}
      </svg>
      <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-[13px]">
        {parts.map((p, i) => (
          <li key={p.label} className={`flex items-center gap-2 ${hover !== null && hover !== i ? "opacity-40" : ""}`} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <Swatch tone={p.tone} />
            {p.label}
            <span className="font-medium text-ash tabular">{format(p.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/// Cumulative step line over time with a hover crosshair readout.
export function Sparkline({ points, label = "events", height = 90 }) {
  const ref = useRef(null);
  const [hover, setHover] = useState(null);
  if (points.length < 1) return <div className="py-6 text-[14px] text-ash">No {label} yet.</div>;
  const W = 560;
  const pad = 6;
  const t0 = points[0].t;
  const t1 = Math.max(points.at(-1).t, t0 + 1);
  const max = Math.max(1, points.at(-1).v);
  const X = (t) => pad + ((t - t0) / (t1 - t0)) * (W - 2 * pad);
  const Y = (v) => height - pad - (v / max) * (height - 2 * pad);
  let d = `M ${X(t0)} ${Y(0)}`;
  for (const p of points) d += ` H ${X(p.t)} V ${Y(p.v)}`;
  d += ` H ${W - pad}`;
  const onMove = (e) => {
    const box = ref.current.getBoundingClientRect();
    const t = t0 + ((e.clientX - box.left) / box.width) * (t1 - t0);
    let best = points[0];
    for (const p of points) if (p.t <= t) best = p;
    setHover(best);
  };
  return (
    <div className="relative">
      <svg ref={ref} viewBox={`0 0 ${W} ${height}`} className="w-full" onMouseMove={onMove} onMouseLeave={() => setHover(null)} role="img" aria-label={`${max} ${label} over time`}>
        <line x1={pad} x2={W - pad} y1={Y(0)} y2={Y(0)} stroke="var(--color-hairline)" />
        <path d={d} fill="none" stroke="var(--color-obsidian)" strokeWidth="2" strokeLinejoin="round" />
        {points.map((p, i) => (
          <circle key={i} cx={X(p.t)} cy={Y(p.v)} r="4" fill="var(--color-obsidian)" stroke="var(--color-paper)" strokeWidth="2" />
        ))}
        {hover && <line x1={X(hover.t)} x2={X(hover.t)} y1={pad} y2={height - pad} stroke="var(--color-ash)" strokeDasharray="3 3" />}
      </svg>
      <div className="mt-1 flex justify-between text-[12px] text-graphite">
        <span>{new Date(t0 * 1000).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" })}</span>
        <span className="font-medium text-ash">{hover ? `${hover.v} ${label} by ${new Date(hover.t * 1000).toLocaleTimeString("en-IN")}${hover.text ? ` · ${hover.text}` : ""}` : `${max} ${label} in total`}</span>
        <span>{new Date(t1 * 1000).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" })}</span>
      </div>
    </div>
  );
}

/// Per-row split bars: part `a` (done, yellow) + part `b` (still pending, dashed), sized against the
/// largest row; optional marker text (e.g. "paid in rupees") after the value.
export function SplitBars({ rows, format = (v) => v, aLabel = "Paid", bLabel = "Pending", empty = "Nothing yet" }) {
  const [hover, setHover] = useState(null);
  if (!rows.length) return <div className="py-6 text-[14px] text-ash">{empty}</div>;
  const max = Math.max(1, ...rows.map((r) => r.a + r.b));
  return (
    <div>
      <div className="flex flex-col gap-2">
        {rows.map((r, i) => (
          <div
            key={r.key ?? r.label}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
            className={`grid grid-cols-[170px_1fr_auto] items-center gap-4 transition-opacity ${hover !== null && hover !== i ? "opacity-40" : ""}`}
          >
            <span className="truncate text-[13px]">{r.label}</span>
            <div className="flex h-5 gap-[2px]">
              {r.a > 0 && <div className="rounded-[4px] bg-signal" style={{ width: `${(r.a / max) * 100}%` }} />}
              {r.b > 0 && <div className="rounded-[4px] border border-dashed border-obsidian bg-white" style={{ width: `${(r.b / max) * 100}%` }} />}
            </div>
            <span className="text-[13px] text-ash tabular">
              {format(r.a)} / {format(r.a + r.b)}
              {r.marker && <span className="ml-2 rounded-full bg-obsidian px-2 py-0.5 text-[12px] text-white">{r.marker}</span>}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-3 flex gap-5 text-[13px] text-ash">
        <span className="flex items-center gap-2">
          <Swatch tone="signal" /> {aLabel}
        </span>
        <span className="flex items-center gap-2">
          <Swatch tone="pending" /> {bLabel}
        </span>
      </div>
    </div>
  );
}
