import { useMemo } from "react";
import { Link } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { useApp } from "../lib/store";
import { fadeUp, liquid, stagger } from "../lib/motion";
import { labeler, eventSentence, eventTone } from "../lib/derive";
import { KpiStat, IconOrb } from "../components/ui/primitives";
import { Section, Card, StatusBadge, Rupees, Button } from "../components/ui/kit";
import { inrCompact, inrUnitFor, pct } from "../lib/format";
import ProofSpine from "../components/ProofSpine";
import { CountUp, Funnel, HBars } from "../components/viz";
import { fraudByReason, pipeline } from "../components/viz/data";
import SankeyFlow from "../components/explore/SankeyFlow";
import { ScaleIcon, VaultIcon, FingerprintIcon, InvoiceIcon, QrIcon, CrossIcon, CheckIcon } from "../components/icons";

const ROOT_DETAILS = [
  { icon: <VaultIcon />, title: "Tagged lot", text: "Every donation becomes a lot that remembers its donor, purpose and deadline — even across chains." },
  { icon: <ScaleIcon />, title: "Rules, not people", text: "Category, budget and a public challenge window. No admin can move or unfreeze money." },
  { icon: <FingerprintIcon />, title: "Signed + nullified", text: "Vendor signs the invoice fields. A global nullifier stops the same bill being used twice." },
  { icon: <QrIcon />, title: "Proven delivery", text: "An independent field partner issues QR cards. Each card signs its own delivery — no names, no secrets on-chain, no card used twice." },
];

export default function Explore() {
  const { state, events, config } = useApp("state", "events", "config");
  const s = state.stats;
  const label = useMemo(() => labeler(config), [config]);
  // one unit for the whole money row, so "₹3.0 L" never sits next to "₹40,000"
  const unit = inrUnitFor(s.tracked, s.inEscrow, s.paidOut);
  // KPIs count up on arrival (≤600ms, instant with reduced motion)
  const money = (v) => ({ value: <CountUp value={v} format={(x) => inrCompact(x, unit).value} />, unit: inrCompact(v, unit).unit });
  const tracked = money(s.tracked);
  const escrow = money(s.inEscrow);
  const paid = money(s.paidOut);
  const fmtInr = (v) => inrCompact(v).value + (inrCompact(v).unit ? ` ${inrCompact(v).unit}` : "");

  return (
    <motion.div variants={stagger()} initial="hidden" animate="show">
      <motion.section variants={fadeUp} className="flex flex-wrap items-end justify-between gap-10 pt-10 pb-8">
        <div className="max-w-[520px]">
          <span className="text-[13px] text-graphite">Every rupee, provable</span>
          <h1 className="font-display text-[64px] leading-[0.95] font-normal tracking-tight">Fund flow</h1>
          <p className="mt-4 text-[15px] text-ash">
            Money moves only when proof moves. Each rupee below is held by a contract, released against a vendor-signed invoice, and finished only when beneficiaries prove delivery.
          </p>
        </div>
        <div data-tour="explore-kpis" className="flex flex-wrap gap-x-14 gap-y-6">
          <KpiStat label="Tracked" {...tracked} />
          <KpiStat label="In escrow" {...escrow} />
          <KpiStat label="Paid out" {...paid} />
          <KpiStat label="Proofs" value={<CountUp value={s.proofs} />} />
          <KpiStat label="Verified" value={<CountUp value={s.verifiedPct} />} unit="%" />
          <KpiStat label="Frauds caught" value={<CountUp value={s.fraudsCaught} />} />
          {s.confidence?.mean != null && <KpiStat label="Proof confidence" value={pct(s.confidence.mean)} />}
        </div>
      </motion.section>

      <motion.div variants={fadeUp}>
        <Ticker events={events} label={label} state={state} />
      </motion.div>

      <motion.div variants={fadeUp}>
        <Section eyebrow="Platform-wide · every rupee accounted for" title="Money pipeline">
          <div className="grid grid-cols-1 gap-8 xl:grid-cols-[1.4fr_1fr]">
            <Card data-tour="explore-pipeline" className="p-6">
              <Funnel steps={pipeline(state)} format={fmtInr} />
            </Card>
            <Card data-tour="explore-fraud" className="p-6">
              <div className="mb-3 flex items-baseline justify-between">
                <span className="text-[15px] font-medium">Fraud caught by type</span>
                <span className="text-[13px] text-ash">recorded on-chain, no auditor</span>
              </div>
              <HBars data={fraudByReason(state)} empty="No fraud attempts recorded yet." />
            </Card>
          </div>
        </Section>
      </motion.div>

      <motion.div variants={fadeUp} data-tour="explore-sankey">
        <Section eyebrow="Live · donor → NGO → purpose → vendor" title="Where the money went" action={<Link to="/donate"><Button variant="signal">Donate with proof</Button></Link>}>
          <SankeyFlow />
        </Section>
      </motion.div>

      <motion.div variants={fadeUp}>
        <Section eyebrow="The evaluation chain" title="Four proofs, every rupee">
          <ProofSpine
            steps={ROOT_DETAILS.map((d) => ({
              status: "done",
              detail: (
                <Card className="p-5">
                  <div className="mb-3 flex items-center gap-3">
                    <IconOrb size={36}>{d.icon}</IconOrb>
                    <span className="font-display text-[18px] font-medium">{d.title}</span>
                  </div>
                  <p className="text-[13px] leading-relaxed text-ash">{d.text}</p>
                </Card>
              ),
            }))}
          />
        </Section>
      </motion.div>

      <motion.div variants={fadeUp}>
        <Section eyebrow="Reputation computed from on-chain history only" title="NGOs">
          <div data-tour="explore-ngos" className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {state.ngos.map((n) => (
              <NgoCard key={n.id} ngo={n} state={state} />
            ))}
          </div>
        </Section>
      </motion.div>
    </motion.div>
  );
}

function NgoCard({ ngo, state }) {
  const raised = state.lots.filter((l) => l.ngoId === ngo.id).reduce((a, l) => a + l.amount, 0);
  return (
    <Card className={`relative overflow-hidden p-6 ${ngo.frozen ? "hatch" : ""}`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-[13px] text-graphite">NGO #{ngo.id}</div>
          <h3 className="font-display text-[24px] leading-tight font-medium">{ngo.name}</h3>
        </div>
        <StatusBadge status={ngo.frozen ? "Frozen" : "Active"} />
      </div>
      <div className="mt-6 flex items-end justify-between">
        <div>
          <div className="text-[13px] text-graphite">Trust score</div>
          <div className="font-display text-[56px] leading-none font-normal tabular">
            {ngo.trust}
            <span className="ml-1 text-[16px] text-graphite">/100</span>
          </div>
        </div>
        <div className="text-right text-[13px] text-ash">
          <div>
            Raised <Rupees value={raised} />
          </div>
          <div>
            Bond <Rupees value={ngo.bond} />
          </div>
          {ngo.confidence?.score != null && (
            <div>
              Proof confidence <span className="font-medium text-obsidian tabular">{pct(ngo.confidence.score)}</span>
            </div>
          )}
        </div>
      </div>
      <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-bone">
        <motion.div
          className={`h-full rounded-full ${ngo.frozen ? "bg-obsidian" : "bg-signal-deep"}`}
          initial={{ width: 0 }}
          animate={{ width: `${ngo.trust}%` }}
          transition={liquid}
        />
      </div>
      <div className="mt-5 grid grid-cols-3 border-t border-hairline pt-4 text-[13px]">
        <Stat k="Payouts" v={ngo.payoutsTotal} />
        <Stat k="Completed" v={ngo.payoutsCompleted} />
        <Stat k="Fraud flags" v={ngo.flagCount} dark={ngo.flagCount > 0} />
      </div>
    </Card>
  );
}

function Stat({ k, v, dark }) {
  return (
    <div>
      <div className="text-graphite">{k}</div>
      <div className={`font-display text-[22px] font-normal tabular ${dark ? "text-obsidian" : ""}`}>{v}</div>
    </div>
  );
}

/// Latest chain events as plain sentences, newest first.
function Ticker({ events, label, state }) {
  const latest = events.slice(0, 6);
  return (
    <div className="border-t border-hairline py-4">
      <div className="mb-3 flex items-center gap-2 text-[13px] text-graphite">
        <motion.span className="h-2 w-2 rounded-full bg-signal-deep" animate={{ opacity: [1, 0.3, 1] }} transition={{ repeat: Infinity, duration: 1.6 }} />
        Live from the chain
      </div>
      <ul className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
        <AnimatePresence initial={false}>
          {latest.map((e) => {
            const tone = eventTone(e.name);
            return (
              <motion.li
                key={e.id}
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={liquid}
                className={`flex items-center gap-3 rounded-full border px-4 py-2 text-[13px] ${
                  tone === "bad" ? "hatch border-obsidian bg-obsidian text-white" : tone === "good" ? "border-signal-deep bg-signal-mist" : "border-hairline bg-white"
                }`}
              >
                <span className="shrink-0">{tone === "bad" ? <CrossIcon size={14} /> : tone === "good" ? <CheckIcon size={14} /> : <InvoiceIcon size={14} />}</span>
                <span className="truncate">{eventSentence(e, label, state)}</span>
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ul>
    </div>
  );
}
