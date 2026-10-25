import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { sankey, sankeyLinkHorizontal, sankeyJustify } from "d3-sankey";
import { api } from "../../lib/api";
import { useApp } from "../../lib/store";
import { labeler } from "../../lib/derive";
import { Empty, Rupees } from "../ui/kit";

const STROKE = {
  verified: "var(--color-signal)",
  pending: "url(#gv-pending)",
  flagged: "url(#gv-fraud)",
  frozen: "var(--color-obsidian)",
  refunded: "var(--color-graphite)",
};
const OPACITY = { verified: 0.85, pending: 1, flagged: 0.9, frozen: 0.8, refunded: 0.45 };

const LEGEND = [
  ["verified", "Verified"],
  ["pending", "In window / awaiting impact"],
  ["flagged", "Challenged"],
  ["frozen", "Frozen"],
  ["refunded", "Refunded"],
];

/// Live fund flow: donor → NGO → category → vendor (and what still sits in escrow).
export default function SankeyFlow({ height = 420 }) {
  const { state, config } = useApp();
  const [flow, setFlow] = useState(null);
  const [width, setWidth] = useState(1200);
  const [hover, setHover] = useState(null);
  const ref = useRef(null);

  useEffect(() => {
    api.get("/api/flow").then(setFlow).catch(() => {});
  }, [state?.updatedAt]);

  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(600, e.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);

  const label = useMemo(() => labeler(config), [config]);

  const graph = useMemo(() => {
    if (!flow?.links?.length) return null;
    const used = new Set(flow.links.flatMap((l) => [l.source, l.target]));
    const nodes = flow.nodes.filter((n) => used.has(n.id)).map((n) => ({ ...n }));
    const links = flow.links.map((l) => ({ ...l }));
    try {
      return sankey()
        .nodeId((d) => d.id)
        .nodeAlign(sankeyJustify)
        .nodeWidth(10)
        .nodePadding(18)
        .extent([
          [0, 8],
          [width - 170, height - 8],
        ])({ nodes, links });
    } catch {
      return null;
    }
  }, [flow, width, height]);

  const nodeLabel = (n) => (n.kind === "donor" || n.kind === "vendor" ? label(n.label) : n.label);

  return (
    <div ref={ref} className="w-full">
      {!graph ? (
        <Empty>No money has moved yet.</Empty>
      ) : (
        <>
          <svg width={width} height={height} className="block overflow-visible">
            <defs>
              <pattern id="gv-pending" patternUnits="userSpaceOnUse" width="7" height="7" patternTransform="rotate(45)">
                <rect width="7" height="7" fill="var(--color-signal-soft)" />
                <line x1="0" y1="0" x2="0" y2="7" stroke="var(--color-signal-deep)" strokeWidth="1.5" />
              </pattern>
              <pattern id="gv-fraud" patternUnits="userSpaceOnUse" width="7" height="7" patternTransform="rotate(45)">
                <rect width="7" height="7" fill="var(--color-obsidian)" />
                <line x1="0" y1="0" x2="0" y2="7" stroke="var(--color-ash)" strokeWidth="1.5" />
              </pattern>
            </defs>
            <g>
              {graph.links.map((l, i) => {
                const dim = hover !== null && hover !== i;
                return (
                  <motion.path
                    key={`${l.source.id}-${l.target.id}-${i}`}
                    d={sankeyLinkHorizontal()(l)}
                    fill="none"
                    stroke={STROKE[l.status] ?? "var(--color-hairline)"}
                    strokeWidth={Math.max(1.5, l.width)}
                    initial={{ pathLength: 0, opacity: 0 }}
                    animate={{ pathLength: 1, opacity: dim ? 0.15 : OPACITY[l.status] ?? 0.6 }}
                    transition={{ pathLength: { duration: 1.4, delay: 0.04 * i, ease: [0.22, 1, 0.36, 1] }, opacity: { duration: 0.25 } }}
                    onMouseEnter={() => setHover(i)}
                    onMouseLeave={() => setHover(null)}
                    style={{ cursor: "pointer" }}
                  />
                );
              })}
            </g>
            <g>
              {graph.nodes.map((n) => (
                <g key={n.id}>
                  <rect
                    x={n.x0}
                    y={n.y0}
                    width={n.x1 - n.x0}
                    height={Math.max(2, n.y1 - n.y0)}
                    rx={3}
                    fill={n.kind === "escrow" ? "var(--color-white)" : "var(--color-obsidian)"}
                    stroke="var(--color-obsidian)"
                    strokeWidth={n.kind === "escrow" ? 1 : 0}
                  />
                  <text x={n.x1 + 8} y={(n.y0 + n.y1) / 2} dy="0.35em" className="fill-obsidian text-[12px]" style={{ fontFamily: "var(--font-sans)" }}>
                    {nodeLabel(n)}
                    <tspan className="fill-graphite" dx="6">
                      ₹{Math.round(n.value).toLocaleString("en-IN")}
                    </tspan>
                  </text>
                </g>
              ))}
            </g>
          </svg>
          <div className="mt-4 flex flex-wrap items-center gap-5 text-[12px] text-graphite">
            {LEGEND.map(([k, t]) => (
              <span key={k} className="flex items-center gap-2">
                <svg width="22" height="8">
                  <rect width="22" height="8" rx="4" fill={STROKE[k]} opacity={OPACITY[k]} />
                </svg>
                {t}
              </span>
            ))}
            {hover !== null && graph.links[hover] && (
              <span className="ml-auto rounded-full bg-charcoal px-3 py-1 text-white">
                {nodeLabel(graph.links[hover].source)} → {nodeLabel(graph.links[hover].target)} · <Rupees value={graph.links[hover].value} />
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
