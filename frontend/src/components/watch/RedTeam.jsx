import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useApp } from "../../lib/store";
import { api } from "../../lib/api";
import { Button, Section } from "../ui/kit";
import { CheckIcon } from "../icons";
import { liquid } from "../../lib/motion";
import { BeakerIcon, PlayIcon, Spinner } from "./shared";

const STEPS = [
  { key: "shell", label: "Register shell vendor", text: "QuickFix Traders stakes ₹5,000 — legal on its own." },
  { key: "doctored", label: "Submit doctored photo", text: "Real BW-1042 photo, number + total edited, signed by the shell. Passes every on-chain check." },
  { key: "duplicate", label: "Resubmit duplicate", text: "Shadow Trust claims BW-1042 again, re-scanned." },
  { key: "forged", label: "Forge signature", text: "Invoice signed in BlueWell's name by the NGO itself." },
  { key: "verdict", label: "Donors' verdict", text: "Funding donors vote on the watcher's challenge; the court resolves." },
];

const KIND_LABEL = {
  genuine: "Genuine receipts",
  "duplicate-rescan": "Duplicate, re-scanned",
  "altered-amount": "Amount altered after signing",
  "ngo-forged-signature": "NGO forged vendor signature",
  "fake-vendor": "Unregistered shell vendor",
  "doctored-photo-colluding-vendor": "Doctored photo, colluding vendor",
};

/// Live red-team attack on the dashboard chain + the isolated 100-receipt benchmark.
export default function RedTeam() {
  const { benchmark, setBenchmark, toast } = useApp();
  const [running, setRunning] = useState(null);
  const [notes, setNotes] = useState({});

  const runStep = async (key) => {
    setRunning(key);
    try {
      const out = await api.post(`/api/demo/attack/${key}`);
      setNotes((n) => ({ ...n, [key]: { ok: true, text: out.note } }));
    } catch (e) {
      setNotes((n) => ({ ...n, [key]: { ok: false, text: e.message } }));
      toast({ title: "Attack step failed", body: e.message, tone: "error" });
    } finally {
      setRunning(null);
    }
  };

  const runBenchmark = async () => {
    setBenchmark({ status: "running" });
    try {
      await api.post("/api/demo/benchmark");
    } catch (e) {
      setBenchmark(null);
      toast({ title: "Benchmark failed to start", body: e.message, tone: "error" });
    }
  };

  const report = benchmark?.status === "done" ? benchmark.report : null;

  return (
    <Section eyebrow="Adversarial · real transactions · nothing scripted on the detection side" title="Red team">
      <div className="grid grid-cols-[1fr_1fr] gap-8">
        <div>
          <div className="mb-3 text-[12px] text-graphite">Live attack — Shadow Trust tries to steal</div>
          <ol className="relative flex flex-col">
            {STEPS.map((s, i) => {
              const note = notes[s.key];
              return (
                <li key={s.key} className="relative flex gap-4 pb-5 last:pb-0">
                  {i < STEPS.length - 1 && <span className="absolute top-11 left-[21px] h-[calc(100%-44px)] w-px bg-hairline" />}
                  <span className={`relative z-10 grid h-11 w-11 shrink-0 place-items-center rounded-full border text-[13px] tabular ${note?.ok ? "border-obsidian bg-obsidian text-white" : "border-hairline bg-white"}`}>
                    {running === s.key ? <Spinner /> : note?.ok ? <CheckIcon size={16} /> : `0${i + 1}`}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-[14px] font-medium">{s.label}</div>
                        <div className="text-[13px] text-graphite">{s.text}</div>
                      </div>
                      <Button variant="ghost" className="h-9 shrink-0 px-4" disabled={!!running} onClick={() => runStep(s.key)}>
                        <PlayIcon width={14} height={14} />
                        Run
                      </Button>
                    </div>
                    <AnimatePresence>
                      {note && (
                        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} transition={liquid} className={`mt-2 rounded-[12px] px-3 py-2 text-[13px] ${note.ok ? "bg-paper text-ash" : "hatch bg-obsidian text-white"}`}>
                          {note.text}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>

        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div className="text-[12px] text-graphite">100 receipts · 30% fraudulent · fresh contracts on an isolated chain</div>
            <Button variant="signal" disabled={benchmark?.status === "running"} onClick={runBenchmark}>
              {benchmark?.status === "running" ? <Spinner /> : <BeakerIcon width={16} height={16} />}
              {benchmark?.status === "running" ? "Running…" : "Run 100-receipt benchmark"}
            </Button>
          </div>
          <AnimatePresence mode="wait">
            {report && !report.error ? (
              <motion.div key="r" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={liquid} className="rounded-[var(--radius-tile)] border border-hairline bg-white">
                <div className="grid grid-cols-2 divide-x divide-hairline border-b border-hairline">
                  <Big label="Fraud caught (recall)" value={(report.recall * 100).toFixed(0)} unit="%" sub={`${report.truePositives}/${report.fraudulent}`} />
                  <Big label="Precision" value={(report.precision * 100).toFixed(0)} unit="%" sub={`${report.falsePositives} false alarms / ${report.genuine} genuine`} />
                </div>
                <div className="grid grid-cols-4 divide-x divide-hairline border-b border-hairline text-center">
                  {[
                    ["TP", report.truePositives, true],
                    ["FN", report.falseNegatives, false],
                    ["FP", report.falsePositives, false],
                    ["TN", report.trueNegatives, true],
                  ].map(([k, v, good]) => (
                    <div key={k} className={`py-3 ${good ? "" : v ? "hatch bg-obsidian text-white" : ""}`}>
                      <div className="text-[11px] opacity-60">{k}</div>
                      <div className="font-display text-[22px] font-light tabular">{v}</div>
                    </div>
                  ))}
                </div>
                <div className="divide-y divide-hairline">
                  {Object.entries(report.byKind).map(([k, v]) => {
                    const genuine = k === "genuine";
                    const good = genuine ? v.caught === 0 : v.caught === v.total;
                    return (
                      <div key={k} className="flex items-center justify-between gap-4 px-5 py-3 text-[13px]">
                        <div className="min-w-0">
                          <div className="font-medium">{KIND_LABEL[k] ?? k}</div>
                          <div className="truncate text-[12px] text-graphite">{genuine ? "must pass untouched" : Object.entries(v.by).map(([b, n]) => `${b} ×${n}`).join(", ")}</div>
                        </div>
                        <span className={`inline-flex h-7 shrink-0 items-center rounded-full px-3 font-medium tabular ${good ? "bg-signal" : "hatch bg-obsidian text-white"}`}>
                          {genuine ? `${v.total - v.caught}/${v.total} passed` : `${v.caught}/${v.total} caught`}
                        </span>
                      </div>
                    );
                  })}
                  <div className="flex items-center justify-between px-5 py-3 text-[13px]">
                    <span className="font-medium">2 frauds in a row → NGO frozen</span>
                    <span className={`inline-flex h-7 items-center rounded-full px-3 font-medium ${report.freezeAfterTwoFrauds ? "bg-signal" : "hatch bg-obsidian text-white"}`}>{report.freezeAfterTwoFrauds ? "yes" : "no"}</span>
                  </div>
                </div>
                <div className="border-t border-hairline px-5 py-3 text-[12px] text-graphite">Ran in {report.seconds.toFixed(1)}s · real EVM execution of the deployed contract code</div>
              </motion.div>
            ) : (
              <motion.div key="e" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="grid min-h-[260px] place-items-center rounded-[var(--radius-tile)] border border-dashed border-hairline p-8 text-center text-[14px] text-graphite">
                {benchmark?.status === "running"
                  ? "Deploying fresh contracts and submitting 100 receipts… about 25 seconds."
                  : report?.error
                    ? `Benchmark failed: ${report.error}`
                    : "Duplicates, altered amounts, forged signatures, shell vendors and doctored photos — mixed into 70 genuine receipts. Measures recall and false alarms."}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </Section>
  );
}

function Big({ label, value, unit, sub }) {
  return (
    <div className="px-5 py-5">
      <div className="text-[12px] text-graphite">{label}</div>
      <div className="font-display text-[56px] leading-none font-light tabular">
        {value}
        <span className="ml-1 text-[20px] text-graphite">{unit}</span>
      </div>
      <div className="mt-1 text-[12px] text-graphite">{sub}</div>
    </div>
  );
}
