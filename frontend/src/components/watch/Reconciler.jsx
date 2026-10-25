import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useApp } from "../../lib/store";
import { api } from "../../lib/api";
import { CATEGORIES, ROLE_META, short } from "../../lib/chain";
import { Button, Field, Input, Rupees, Section, Segmented } from "../ui/kit";
import { CheckIcon, CrossIcon } from "../icons";
import { liquid } from "../../lib/motion";

const select = "h-11 rounded-[var(--radius-input)] border border-hairline bg-white px-3 text-[14px] outline-none focus:border-obsidian";

/// Compares what an NGO publishes to donors against what the chain recorded.
export default function Reconciler() {
  const { state, config, toast } = useApp();
  const [ngoId, setNgoId] = useState("0");
  const [cats, setCats] = useState([{ category: "Water", spent: "" }]);
  const [rows, setRows] = useState([{ donor: "", payoutId: "", amount: "" }]);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  const donorName = (addr) => {
    const role = Object.entries(config.roles).find(([, r]) => r.address.toLowerCase() === addr?.toLowerCase())?.[0];
    return ROLE_META[role]?.label ?? short(addr);
  };
  const donors = [...new Set(state.lots.map((l) => l.donor))];
  const payouts = state.payouts.filter((p) => p.ngoId === Number(ngoId));

  const loadExample = () => {
    const p = state.payouts.find((x) => x.ngoId === 0 && x.status !== "Cancelled") ?? state.payouts[0];
    if (!p) return toast({ title: "No payout to use", body: "Seed the chain first.", tone: "error" });
    const funders = [...new Set(p.shares.map((s) => state.lots[s.lotId].donor))];
    setNgoId(String(p.ngoId));
    setCats([{ category: p.category, spent: String(p.amount * 1.5) }]);
    setRows(funders.map((d) => ({ donor: d, payoutId: String(p.id), amount: String(p.amount) })));
    setResult(null);
  };

  const submit = async () => {
    const byDonor = new Map();
    for (const r of rows) {
      const p = state.payouts[Number(r.payoutId)];
      if (!r.donor || !p || !r.amount) continue;
      if (!byDonor.has(r.donor)) byDonor.set(r.donor, []);
      byDonor.get(r.donor).push({ fileHash: p.fileHash, amount: Number(r.amount) });
    }
    const report = {
      ngoId: Number(ngoId),
      categories: cats.filter((c) => c.spent !== "").map((c) => ({ category: c.category, spent: Number(c.spent) })),
      donorReports: [...byDonor].map(([donor, invoices]) => ({ donor, invoices })),
    };
    setBusy(true);
    try {
      setResult(await api.post("/api/reconcile", report));
    } catch (e) {
      toast({ title: "Reconcile failed", body: e.message, tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  const setRow = (i, k, v) => setRows((xs) => xs.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const setCat = (i, k, v) => setCats((xs) => xs.map((x, j) => (j === i ? { ...x, [k]: v } : x)));

  return (
    <Section
      eyebrow="Published report vs. the ledger"
      title="Report reconciler"
      action={
        <Button variant="ghost" onClick={loadExample}>
          Load example: double-counted report
        </Button>
      }
    >
      <div className="grid grid-cols-[1fr_1fr] gap-8">
        <div className="flex flex-col gap-6">
          <Field label="NGO whose report you are checking">
            <Segmented id="recon-ngo" value={ngoId} onChange={(v) => (setNgoId(v), setResult(null))} options={state.ngos.map((n) => ({ value: String(n.id), label: n.name }))} />
          </Field>

          <div>
            <div className="mb-2 text-[12px] text-graphite">"We spent…" — category claims</div>
            <div className="flex flex-col gap-2">
              {cats.map((c, i) => (
                <div key={i} className="grid grid-cols-[160px_1fr] gap-2">
                  <select className={select} value={c.category} onChange={(e) => setCat(i, "category", e.target.value)}>
                    {CATEGORIES.map((x) => (
                      <option key={x}>{x}</option>
                    ))}
                  </select>
                  <Input type="number" placeholder="Claimed ₹" value={c.spent} onChange={(e) => setCat(i, "spent", e.target.value)} />
                </div>
              ))}
              <button className="self-start text-[13px] text-ash underline underline-offset-2" onClick={() => setCats((x) => [...x, { category: "Medical", spent: "" }])}>
                + category
              </button>
            </div>
          </div>

          <div>
            <div className="mb-2 text-[12px] text-graphite">"Your money funded…" — per-donor impact reports</div>
            <div className="flex flex-col gap-2">
              {rows.map((r, i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr_130px] gap-2">
                  <select className={select} value={r.donor} onChange={(e) => setRow(i, "donor", e.target.value)}>
                    <option value="">Donor…</option>
                    {donors.map((d) => (
                      <option key={d} value={d}>
                        {donorName(d)}
                      </option>
                    ))}
                  </select>
                  <select className={select} value={r.payoutId} onChange={(e) => setRow(i, "payoutId", e.target.value)}>
                    <option value="">Invoice / payout…</option>
                    {payouts.map((p) => (
                      <option key={p.id} value={p.id}>
                        #{p.id} · {p.category} · ₹{p.amount.toLocaleString("en-IN")}
                      </option>
                    ))}
                  </select>
                  <Input type="number" placeholder="Claimed ₹" value={r.amount} onChange={(e) => setRow(i, "amount", e.target.value)} />
                </div>
              ))}
              <button className="self-start text-[13px] text-ash underline underline-offset-2" onClick={() => setRows((x) => [...x, { donor: "", payoutId: "", amount: "" }])}>
                + donor report line
              </button>
            </div>
          </div>

          <Button variant="primary" className="self-start" disabled={busy} onClick={submit}>
            Reconcile against the chain
          </Button>
        </div>

        <div>
          <AnimatePresence mode="wait">
            {result ? (
              <motion.div key="res" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={liquid} className="rounded-[var(--radius-tile)] border border-hairline bg-white">
                <div className={`flex items-center justify-between rounded-t-[var(--radius-tile)] px-6 py-5 ${result.verdict === "consistent" ? "bg-signal" : "hatch bg-obsidian text-white"}`}>
                  <div>
                    <div className="text-[12px] opacity-70">Verdict</div>
                    <div className="font-display text-[28px] font-light capitalize">{result.verdict}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[12px] opacity-70">Problems</div>
                    <div className="font-display text-[28px] font-light">{result.problems}</div>
                  </div>
                </div>
                <div className="divide-y divide-hairline">
                  {result.lines.map((l, i) => {
                    const okLine = l.status === "match" || l.status === "under-claimed";
                    return (
                      <motion.div key={i} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.06 }} className="flex items-start justify-between gap-4 px-6 py-4">
                        <div className="min-w-0">
                          <div className="text-[14px] font-medium">{l.label}</div>
                          {l.detail && <div className="mt-0.5 text-[13px] text-ash">{l.detail}</div>}
                          <div className="mt-1 text-[12px] text-graphite">
                            claimed <Rupees value={l.claimed} /> · on-chain <Rupees value={l.onChain} />
                          </div>
                        </div>
                        <span className={`inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-3 text-[12px] font-medium ${okLine ? "bg-signal text-obsidian" : "hatch bg-obsidian text-white"}`}>
                          {okLine ? <CheckIcon size={14} /> : <CrossIcon size={14} />}
                          {l.status}
                        </span>
                      </motion.div>
                    );
                  })}
                  {!result.lines.length && <div className="px-6 py-4 text-[14px] text-graphite">Nothing to compare — add claims on the left.</div>}
                </div>
              </motion.div>
            ) : (
              <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="grid h-full min-h-[280px] place-items-center rounded-[var(--radius-tile)] border border-dashed border-hairline p-8 text-center text-[14px] text-graphite">
                Paste what the NGO told its donors. Every line is checked against the lots and payouts recorded on-chain — over-claims, invoices that don't exist, and the same invoice sold to several donors.
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </Section>
  );
}
