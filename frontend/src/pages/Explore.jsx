import { useMemo } from "react";
import { Link } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { useApp } from "../lib/store";
import { fadeUp, liquid, stagger } from "../lib/motion";
import { labeler, eventSentence, eventTone } from "../lib/derive";
import { KpiStat, IconOrb } from "../components/ui/primitives";
import { Section, Card, StatusBadge, Rupees, compactInr, Button } from "../components/ui/kit";
import ProofSpine from "../components/ProofSpine";
import SankeyFlow from "../components/explore/SankeyFlow";
import { ScaleIcon, VaultIcon, FingerprintIcon, InvoiceIcon, QrIcon, CrossIcon, CheckIcon } from "../components/icons";

const ROOT_DETAILS = [
  { icon: <VaultIcon />, title: "Tagged lot", text: "Every donation becomes a lot that remembers its donor, purpose and deadline — even across chains." },
  { icon: <ScaleIcon />, title: "Rules, not people", text: "Category, budget and a public challenge window. No admin can move or unfreeze money." },
  { icon: <FingerprintIcon />, title: "Signed + nullified", text: "Vendor signs the invoice fields. A global nullifier stops the same bill being used twice." },
  { icon: <QrIcon />, title: "Proven delivery", text: "Beneficiaries confirm with a QR card. A Merkle proof shows they're on the list — names never go on-chain." },
];

export default function Explore() {
  const { state, events, config } = useApp();
  const s = state.stats;
  const label = useMemo(() => labeler(config), [config]);
  const [tracked, trackedUnit] = compactInr(s.tracked);
  const [escrow, escrowUnit] = compactInr(s.inEscrow);
  const [paid, paidUnit] = compactInr(s.paidOut);

  return (
    <motion.div variants={stagger(0.07)} initial="hidden" animate="show">
      <motion.section variants={fadeUp} className="flex flex-wrap items-end justify-between gap-10 pt-10 pb-8">
        <div className="max-w-[520px]">
          <span className="text-[12px] text-graphite">Every rupee, provable</span>
          <h1 className="font-display text-[64px] leading-[0.95] font-light tracking-tight">Fund flow</h1>
          <p className="mt-4 text-[15px] text-ash">
            Money moves only when proof moves. Each rupee below is held by a contract, released against a vendor-signed invoice, and finished only when beneficiaries prove delivery.
          </p>
        </div>
        <div className="flex flex-wrap gap-x-14 gap-y-6">
          <KpiStat label="Tracked" value={tracked} unit={trackedUnit} />
          <KpiStat label="In escrow" value={escrow} unit={escrowUnit} />
          <KpiStat label="Paid out" value={paid} unit={paidUnit} />
          <KpiStat label="Proofs" value={s.proofs.toLocaleString("en-IN")} />
          <KpiStat label="Verified" value={s.verifiedPct} unit="%" />
          <KpiStat label="Frauds caught" value={s.fraudsCaught} />
        </div>
      </motion.section>

      <motion.div variants={fadeUp}>
        <Ticker events={events} label={label} state={state} />
      </motion.div>

      <motion.div variants={fadeUp}>
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
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
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
    <Card whileHover={{ y: -2 }} className={`relative overflow-hidden p-6 ${ngo.frozen ? "hatch" : ""}`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-[12px] text-graphite">NGO #{ngo.id}</div>
          <h3 className="font-display text-[24px] leading-tight font-medium">{ngo.name}</h3>
        </div>
        <StatusBadge status={ngo.frozen ? "Frozen" : "Active"} />
      </div>
      <div className="mt-6 flex items-end justify-between">
        <div>
          <div className="text-[12px] text-graphite">Trust score</div>
          <div className="font-display text-[56px] leading-none font-light tabular">
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
        </div>
      </div>
      <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-bone">
        <motion.div
          className={`h-full rounded-full ${ngo.frozen ? "bg-obsidian" : "bg-signal-deep"}`}
          initial={{ width: 0 }}
          animate={{ width: `${ngo.trust}%` }}
          transition={{ ...liquid, delay: 0.2 }}
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
      <div className={`font-display text-[22px] font-light tabular ${dark ? "text-obsidian" : ""}`}>{v}</div>
    </div>
  );
}

/// Latest chain events as plain sentences, newest first.
function Ticker({ events, label, state }) {
  const latest = events.slice(0, 6);
  return (
    <div className="border-t border-hairline py-4">
      <div className="mb-3 flex items-center gap-2 text-[12px] text-graphite">
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
                layout
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
