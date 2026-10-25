import { useState } from "react";
import { motion } from "framer-motion";
import { useApp, useRerenderAt, payoutBoundaries } from "../lib/store";
import { CATEGORIES } from "../lib/chain";
import { fadeUp, stagger } from "../lib/motion";
import { Button, Card, Countdown, Empty, Rupees, RoleGate, Section, Segmented, StatusBadge } from "../components/ui/kit";
import { IconOrb } from "../components/ui/primitives";
import { CategoryIcon, InvoiceIcon, ScaleIcon } from "../components/icons";
import PreparePayout from "../components/ops/PreparePayout";
import { humanize, sameAddr, useApiList } from "../components/ops/shared";

export default function Ngo() {
  return (
    <RoleGate kinds={["NGO"]}>
      <Console />
    </RoleGate>
  );
}

function Console() {
  const { state, address } = useApp("state", "address");
  const ngo = state.ngos.find((n) => sameAddr(n.admin, address));
  const [tab, setTab] = useState("inbox");
  const [selected, setSelected] = useState(null);
  const [invoices] = useApiList(ngo ? `/api/invoices?ngoId=${ngo.id}` : null);
  if (!ngo) return <Empty>This wallet has not registered an NGO.</Empty>;

  const lots = state.lots.filter((l) => l.ngoId === ngo.id);
  const payouts = state.payouts.filter((p) => p.ngoId === ngo.id).sort((a, b) => b.id - a.id);
  const flags = state.flags.filter((f) => f.ngoId === ngo.id);
  const inbox = invoices.filter((i) => i.status === "signed");
  const used = invoices.filter((i) => i.status !== "signed");
  const list = tab === "inbox" ? inbox : used;
  const invoice = invoices.find((i) => i.id === selected);

  return (
    <motion.div variants={stagger()} initial="hidden" animate="show">
      <motion.section variants={fadeUp} className="flex items-end justify-between gap-8 pt-10 pb-8">
        <div>
          <span className="text-[13px] text-graphite">NGO console</span>
          <h1 className="font-display text-[56px] leading-none font-normal tracking-tight">{ngo.name}</h1>
          <div className="mt-3 flex items-center gap-2">
            <StatusBadge status={ngo.frozen ? "Frozen" : "Active"} />
            {flags.map((f) => (
              <StatusBadge key={f.id} status="Fraud" label={humanize(f.reason)} />
            ))}
          </div>
        </div>
        <div className="flex items-end gap-14">
          <Stat label="Trust score" value={ngo.trust} unit="/100" icon={<ScaleIcon />} />
          <Stat label="Bond at stake" value={<Rupees value={ngo.bond} />} />
          <Stat label="Fraud flags" value={ngo.flagCount} unit="/2" />
          <Stat label="Payouts verified" value={`${ngo.payoutsCompleted}/${ngo.payoutsTotal}`} />
        </div>
      </motion.section>

      <motion.div variants={fadeUp}>
        <Section eyebrow="② Escrow condition" title="Category vaults">
          <div className="grid grid-cols-3 gap-4">
            {CATEGORIES.map((cat) => {
              const ls = lots.filter((l) => l.category === cat);
              const total = ls.reduce((s, l) => s + l.amount, 0);
              const left = ls.reduce((s, l) => s + l.remaining, 0);
              return (
                <Card key={cat} className="p-6 hover:border-ash/40">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-3 text-[16px] font-medium">
                      <IconOrb>
                        <CategoryIcon category={cat} />
                      </IconOrb>
                      {cat}
                    </span>
                    <span className="text-[13px] text-graphite">{ls.length} lots</span>
                  </div>
                  <div className="mt-6 font-display text-[36px] leading-none font-normal">
                    <Rupees value={left} />
                  </div>
                  <div className="mt-1 text-[13px] text-graphite">
                    locked in escrow of <Rupees value={total} /> donated
                  </div>
                  <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-hairline">
                    <motion.div className="h-full bg-signal-deep" initial={{ width: 0 }} animate={{ width: total ? `${(100 * (total - left)) / total}%` : 0 }} />
                  </div>
                </Card>
              );
            })}
          </div>
        </Section>
      </motion.div>

      <motion.div variants={fadeUp}>
        <Section
          eyebrow="③ Off-chain invoice proof"
          title="Vendor-signed invoices"
          action={
            <Segmented
              id="ngo-inv"
              value={tab}
              onChange={(v) => {
                setTab(v);
                setSelected(null);
              }}
              options={[
                { value: "inbox", label: `Inbox ${inbox.length}` },
                { value: "used", label: `Already used ${used.length}` },
              ]}
            />
          }
        >
          {list.length === 0 ? (
            <Empty>{tab === "inbox" ? "No signed invoices waiting. Vendors issue them from the Vendor portal." : "Nothing submitted yet."}</Empty>
          ) : (
            <div className="grid grid-cols-4 gap-3">
              {list.map((i) => (
                <motion.button
                  key={i.id}
                  whileHover={{ y: -2 }}
                  onClick={() => setSelected(i.id === selected ? null : i.id)}
                  className={`rounded-[var(--radius-tile)] border p-4 text-left ${i.id === selected ? "border-obsidian bg-signal-mist" : "border-hairline bg-paper"}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-2 text-[14px] font-medium">
                      <InvoiceIcon /> {i.invoiceNo}
                    </span>
                    <CategoryIcon category={CATEGORIES[i.category]} />
                  </div>
                  <div className="mt-3 font-display text-[24px] font-normal">
                    <Rupees value={i.amount} />
                  </div>
                  <div className="mt-1 text-[13px] text-graphite">
                    {new Date(i.date * 1000).toLocaleDateString("en-IN")} · {i.status}
                  </div>
                </motion.button>
              ))}
            </div>
          )}
          {invoice && (
            <div className="mt-6">
              {tab === "used" && (
                <div className="hatch mb-4 rounded-[var(--radius-tile)] border border-obsidian bg-white p-4 text-[13px]">
                  This invoice was already submitted. Resubmitting it is a duplicate-spend attempt — the global nullifier will catch it.
                </div>
              )}
              <PreparePayout key={invoice.id} ngo={ngo} invoice={invoice} onDone={() => setSelected(null)} />
            </div>
          )}
        </Section>
      </motion.div>

      <motion.div variants={fadeUp}>
        <Section eyebrow="Payouts" title="Money in motion">
          {payouts.length === 0 ? <Empty>No payouts yet.</Empty> : <PayoutTable payouts={payouts} frozen={ngo.frozen} />}
        </Section>
      </motion.div>
    </motion.div>
  );
}

function Stat({ label, value, unit, icon }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="flex items-center gap-1.5 text-[13px] text-graphite">
        {icon}
        {label}
      </span>
      <span className="font-display text-[40px] leading-none font-normal tabular">
        {value}
        {unit && <span className="ml-1 text-[16px] text-graphite">{unit}</span>}
      </span>
    </div>
  );
}

/// Shared by the NGO console: every payout, its window and deliveries. Release is permissionless.
export function PayoutTable({ payouts, frozen }) {
  const { c, tx, chainNow, state } = useApp("c", "tx", "chainNow", "state");
  useRerenderAt(payoutBoundaries(payouts));
  return (
    <div className="overflow-hidden rounded-[var(--radius-card)] border border-hairline bg-paper">
      <div className="grid grid-cols-[64px_1.2fr_1fr_1fr_1fr_1fr_140px] gap-4 border-b border-hairline px-6 py-3 text-[13px] text-graphite">
        <span>#</span>
        <span>Vendor · invoice</span>
        <span>Amount</span>
        <span>Paid</span>
        <span>Deliveries</span>
        <span>Status</span>
        <span />
      </div>
      {payouts.map((p) => {
        const vendor = state.vendors.find((v) => sameAddr(v.address, p.vendor));
        const canRelease = p.status === "Pending" && chainNow() >= p.releaseAt && !frozen;
        return (
          <div key={p.id} className="grid grid-cols-[64px_1.2fr_1fr_1fr_1fr_1fr_140px] items-center gap-4 border-b border-hairline px-6 py-4 text-[14px] last:border-b-0">
            <span className="font-mono text-graphite">{p.id}</span>
            <span className="flex items-center gap-2">
              <CategoryIcon category={p.category} />
              <span>
                {p.invoice?.invoiceNo ?? "Invoice"} <span className="text-[13px] text-graphite">· {vendor?.category ?? "vendor"}</span>
              </span>
            </span>
            <Rupees value={p.amount} />
            <Rupees value={p.paid} />
            <span className="tabular">
              {p.deliveries}/{p.deliveriesRequired}
            </span>
            <span className="flex flex-col items-start gap-1">
              <StatusBadge status={p.status} />
              {p.status === "Pending" && (
                <span className="text-[13px] text-graphite">
                  window <Countdown until={p.releaseAt} done="closed" />
                </span>
              )}
            </span>
            <span>
              {canRelease && (
                <Button variant="signal" className="h-9 px-4" onClick={() => tx(`Release payout #${p.id}`, () => c.vault.release(p.id)).catch(() => {})}>
                  Release 70%
                </Button>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}
