import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { useApp } from "../../lib/store";
import { Empty, HashText, Section, Segmented } from "../ui/kit";
import { EyeIcon } from "../icons";
import { liquid } from "../../lib/motion";
import { ipfsHref, LinkIcon } from "./shared";

const BENFORD = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => Math.log10(1 + 1 / d));
const MIN_SAMPLES = 15;

/// Same test the watcher bot runs (Nigrini MAD thresholds), recomputed from on-chain payout amounts.
function benford(amounts) {
  if (amounts.length < MIN_SAMPLES) return null;
  const counts = Array(9).fill(0);
  for (const a of amounts) {
    const d = Number(String(Math.floor(a)).replace(/^0+/, "")[0]);
    if (d >= 1 && d <= 9) counts[d - 1]++;
  }
  const n = counts.reduce((a, b) => a + b, 0);
  const observed = counts.map((c) => c / n);
  const mad = observed.reduce((s, o, i) => s + Math.abs(o - BENFORD[i]), 0) / 9;
  const verdict = mad < 0.006 ? "close" : mad < 0.012 ? "acceptable" : mad < 0.015 ? "marginal" : "nonconforming";
  return { samples: n, mad, verdict, observed };
}

export default function WatcherFeed() {
  const { findings, config } = useApp("findings", "config");
  const challenges = findings.filter((f) => f.kind === "challenge");

  return (
    <Section eyebrow={`Open-source bot · ${config.roles.watcher.address.slice(0, 8)}… · same powers as any citizen`} title="Watcher">
      <div className="grid grid-cols-[1.3fr_1fr] gap-8">
        <div>
          <div className="mb-3 text-[13px] text-graphite">Evidence published</div>
          {!challenges.length ? (
            <Empty>The watcher compares every receipt photo against all earlier ones and checks invoice dates. Findings appear here live.</Empty>
          ) : (
            <div className="flex flex-col divide-y divide-hairline rounded-[var(--radius-tile)] border border-hairline bg-white">
              {challenges.map((f, i) => (
                <motion.div key={`${f.payoutId}-${f.at}`} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ ...liquid, delay: Math.min(i, 6) * 0.04 }} className="flex gap-4 p-5">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-obsidian text-white">
                    <EyeIcon />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-[14px] font-medium">Payout #{f.payoutId} {f.skipped ? "· not challenged" : "· challenged on-chain"}</span>
                      <span className="text-[13px] text-graphite">{new Date(f.at).toLocaleTimeString()}</span>
                    </div>
                    <ul className="mt-1 space-y-1 text-[13px] text-ash">
                      {f.evidence?.map((e) => (
                        <li key={e.check}>
                          <span className="font-mono text-[13px] text-obsidian">{e.check}</span> — {e.detail}
                        </li>
                      ))}
                      {f.skipped && <li className="text-graphite">{f.skipped}</li>}
                    </ul>
                    <div className="mt-2 flex items-center gap-4 text-[13px]">
                      {f.evidenceURI && (
                        <a href={ipfsHref(f.evidenceURI)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-ash underline underline-offset-2 hover:text-obsidian">
                          <LinkIcon width={14} height={14} />
                          evidence (IPFS)
                        </a>
                      )}
                      {f.tx && <HashText value={f.tx} />}
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </div>
        <BenfordPanel />
      </div>
    </Section>
  );
}

function BenfordPanel() {
  const { state } = useApp("state");
  const [ngo, setNgo] = useState("all");
  const amounts = useMemo(() => state.payouts.filter((p) => ngo === "all" || p.ngoId === Number(ngo)).map((p) => p.amount), [state.payouts, ngo]);
  const res = benford(amounts);
  const W = 360, H = 160, bw = W / 9;
  const max = Math.max(...BENFORD, ...(res?.observed ?? [0])) * 1.1;

  return (
    <div className="rounded-[var(--radius-tile)] border border-hairline bg-white p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-[13px] text-graphite">Benford's law · first digit of invoice amounts</div>
          <div className="mt-1 font-display text-[22px] font-normal">{res ? res.verdict : "Not enough data"}</div>
        </div>
        {res && (
          <div className="text-right">
            <div className="text-[13px] text-graphite">MAD</div>
            <div className="font-display text-[22px] font-normal tabular">{res.mad.toFixed(4)}</div>
          </div>
        )}
      </div>
      <div className="mt-3">
        <Segmented id="benford" value={ngo} onChange={setNgo} options={[{ value: "all", label: "All" }, ...state.ngos.map((n) => ({ value: String(n.id), label: n.name }))]} />
      </div>
      <svg viewBox={`0 0 ${W} ${H + 20}`} className="mt-4 w-full" aria-label="Benford distribution">
        {BENFORD.map((e, i) => {
          const eh = (e / max) * H;
          const oh = res ? (res.observed[i] / max) * H : 0;
          return (
            <g key={i}>
              {res && <motion.rect x={i * bw + 8} width={bw - 16} rx="4" fill="var(--color-signal)" initial={{ height: 0, y: H }} animate={{ height: oh, y: H - oh }} transition={{ ...liquid, delay: i * 0.04 }} />}
              <rect x={i * bw + 6} y={H - eh} width={bw - 12} height={eh} rx="5" fill="none" stroke="var(--color-obsidian)" strokeWidth="1" strokeDasharray="3 3" />
              <text x={i * bw + bw / 2} y={H + 16} textAnchor="middle" fontSize="11" fill="var(--color-graphite)">
                {i + 1}
              </text>
            </g>
          );
        })}
        <line x1="0" x2={W} y1={H} y2={H} stroke="var(--color-hairline)" />
      </svg>
      <div className="mt-2 flex gap-4 text-[13px] text-graphite">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-signal" /> observed
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm border border-dashed border-obsidian" /> expected
        </span>
        <span className="ml-auto">{amounts.length} payouts</span>
      </div>
      {!res && <p className="mt-3 text-[13px] text-graphite">Needs at least {MIN_SAMPLES} payouts. Made-up amounts drift from the natural first-digit pattern; this is a signal for challengers, never an automatic slash.</p>}
    </div>
  );
}
