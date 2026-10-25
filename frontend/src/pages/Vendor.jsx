import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { ethers } from "ethers";
import { api, ipfsUrl } from "../lib/api";
import { useApp } from "../lib/store";
import { CATEGORIES, CAT } from "../lib/chain";
import { fadeUp, stagger } from "../lib/motion";
import { Button, Card, Countdown, Empty, Field, HashText, Input, KV, Rupees, RoleGate, Section, Segmented, StatusBadge } from "../components/ui/kit";
import { IconOrb } from "../components/ui/primitives";
import { CategoryIcon, CrossIcon, InvoiceIcon, UploadIcon } from "../components/icons";
import { sameAddr, useApiList } from "../components/ops/shared";

export default function Vendor() {
  return (
    <RoleGate kinds={["Vendor"]}>
      <Portal />
    </RoleGate>
  );
}

function Portal() {
  const { state, address } = useApp("state", "address");
  const me = state.vendors.find((v) => sameAddr(v.address, address));
  const [invoices, reload] = useApiList(`/api/invoices?vendor=${address}`);
  const payouts = state.payouts.filter((p) => sameAddr(p.vendor, address));
  const received = payouts.reduce((s, p) => s + p.paid, 0);

  return (
    <motion.div variants={stagger()} initial="hidden" animate="show">
      <motion.section variants={fadeUp} className="flex items-end justify-between gap-8 pt-10 pb-8">
        <div>
          <span className="text-[13px] text-graphite">Vendor portal</span>
          <h1 className="font-display text-[56px] leading-none font-normal tracking-tight">Issue signed invoices</h1>
          <div className="mt-3 flex items-center gap-2">
            {me?.registered ? (
              <StatusBadge status="Active" label={`${me.offRamp ? "Fiat payment agent" : "Supplier"} · ${me.category}`} />
            ) : (
              <StatusBadge status={me ? "Fraud" : "Pending"} label={me ? "Stake slashed — deregistered" : "Not registered"} />
            )}
            <HashText value={address} />
          </div>
        </div>
        <div className="flex items-end gap-14">
          <Big label="Stake" value={<Rupees value={me?.stake ?? 0} />} />
          <Big label="Received" value={<Rupees value={received} />} />
          <Big label="Invoices" value={invoices.length} />
        </div>
      </motion.section>

      {me?.registered && me.offRamp && (
        <motion.div variants={fadeUp}>
          <SettleFiat payouts={payouts} />
        </motion.div>
      )}

      <motion.div variants={fadeUp}>{me?.registered ? <IssueInvoice vendor={me} onIssued={reload} /> : <Register />}</motion.div>

      <motion.div variants={fadeUp}>
        <Section eyebrow="History" title="My invoices and payments">
          {invoices.length === 0 ? (
            <Empty>No invoices issued yet.</Empty>
          ) : (
            <div className="overflow-hidden rounded-[var(--radius-card)] border border-hairline bg-paper">
              {invoices.map((i) => {
                const p = payouts.find((x) => x.fileHash === i.fileHash);
                return (
                  <div key={i.id} className="grid grid-cols-[1.2fr_1fr_1fr_1fr_1fr] items-center gap-4 border-b border-hairline px-6 py-4 text-[14px] last:border-b-0">
                    <span className="flex items-center gap-2">
                      <InvoiceIcon /> {i.invoiceNo}
                    </span>
                    <span className="text-graphite">{state.ngos[i.ngoId]?.name}</span>
                    <Rupees value={i.amount} />
                    <span>{p ? <StatusBadge status={p.status} /> : <StatusBadge status={i.status === "flagged" ? "Fraud" : "Pending"} label={i.status === "flagged" ? "Flagged" : "Awaiting NGO"} />}</span>
                    <span className="text-right">
                      {p ? (
                        <>
                          <Rupees value={p.paid} /> <span className="text-graphite">paid</span>
                        </>
                      ) : (
                        <span className="text-graphite">—</span>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </Section>
      </motion.div>
    </motion.div>
  );
}

function Big({ label, value }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[13px] text-graphite">{label}</span>
      <span className="font-display text-[40px] leading-none font-normal tabular">{value}</span>
    </div>
  );
}

/// Stake + register. The stake is what a fake vendor loses when donors uphold a challenge.
function Register() {
  const { c, tx } = useApp("c", "tx");
  const [role, setRole] = useState("supplier");
  const [cat, setCat] = useState("Water");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    try {
      const stake = await c.vault.VENDOR_STAKE();
      await tx("Approve vendor stake", () => c.dinr.approve(c.vault.target, stake));
      if (role === "agent") await tx("Register fiat payment agent", () => c.vault.registerOffRamp(CAT[cat], ethers.id(name)));
      else await tx("Register vendor", () => c.vault.registerVendor(CAT[cat], ethers.id(name)));
    } catch {
      // toasted
    } finally {
      setBusy(false);
    }
  }
  return (
    <Section eyebrow="Registration" title="Stake to sign invoices">
      <Card className="grid grid-cols-[1fr_auto] items-end gap-6 p-6">
        <div className="flex flex-col gap-4">
          <Field label="How you get paid (locked after registration)">
            <Segmented
              id="vrole"
              value={role}
              onChange={setRole}
              options={[
                { value: "supplier", label: "Supplier · paid in dINR" },
                { value: "agent", label: "Fiat payment agent (off-ramp)" },
              ]}
            />
          </Field>
          {role === "agent" && (
            <p className="max-w-[620px] text-[14px] text-ash">
              You receive dINR from escrow and pay local shops in rupees by bank transfer. For every payout you must sign a record of that bank transfer, or anyone can
              flag it as an unexplained transfer and take your stake.
            </p>
          )}
          <Field label="Category you supply (locked after registration)">
            <Segmented id="vreg" value={cat} onChange={setCat} options={CATEGORIES.map((x) => ({ value: x, label: x, icon: <CategoryIcon category={x} /> }))} />
          </Field>
          <Field label="Legal name / GSTIN" hint="Only its hash goes on-chain.">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="GSTIN 27AABCB1234F1Z5 · Your Firm" />
          </Field>
        </div>
        <Button variant="signal" disabled={!name || busy} onClick={go}>
          {role === "agent" ? "Stake ₹5,000 and register as agent" : "Stake ₹5,000 and register"}
        </Button>
      </Card>
    </Section>
  );
}

function IssueInvoice({ vendor, onIssued }) {
  const { state, chain, signer, address, toast } = useApp("state", "chain", "signer", "address", "toast");
  const [ngoId, setNgoId] = useState(state.ngos.find((n) => !n.frozen)?.id ?? 0);
  const [invoiceNo, setInvoiceNo] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [items, setItems] = useState([{ qty: "1", name: "", price: "" }]);
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const total = items.reduce((s, i) => s + Number(i.qty || 0) * Number(i.price || 0), 0);
  const category = CAT[vendor.category];
  const dateSec = Math.floor(new Date(`${date}T00:00:00Z`).getTime() / 1000);

  const typed = useMemo(
    () =>
      file && invoiceNo && total > 0
        ? chain.typedInvoice({ vendor: address, ngoId, invoiceNo, amount: total, date: dateSec, category, fileHash: file.fileHash })
        : null,
    [file, invoiceNo, total, ngoId, dateSec, category, address, chain],
  );

  async function onFile(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const meta = await api.upload(f);
      setFile({ ...meta, preview: URL.createObjectURL(f) });
    } catch (err) {
      toast({ title: "Upload failed", body: err.message, tone: "error" });
    }
  }

  async function sign() {
    setBusy(true);
    try {
      const fields = { vendor: address, ngoId, invoiceNo, amount: total, date: dateSec, category, fileHash: file.fileHash };
      const signature = await chain.signInvoice(signer, fields);
      const lineItems = items.filter((i) => i.name).map((i) => ({ qty: Number(i.qty), name: i.name, price: Number(i.price) }));
      await api.post("/api/invoices", { ...fields, signature, lineItems, cid: file.cid });
      toast({ title: `Invoice ${invoiceNo} signed`, body: `Sent to ${state.ngos[ngoId]?.name}'s inbox. Signature is EIP-712, verifiable on-chain.`, tone: "ok" });
      setInvoiceNo("");
      setItems([{ qty: "1", name: "", price: "" }]);
      setFile(null);
      onIssued?.();
    } catch (err) {
      toast({ title: "Could not sign invoice", body: err.message, tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section eyebrow="③ Off-chain invoice proof" title="New invoice">
      <div className="grid grid-cols-12 gap-6">
        <Card className="col-span-7 flex flex-col gap-5 p-6">
          <Field label="Bill to NGO">
            <Segmented id="vngo" value={ngoId} onChange={setNgoId} options={state.ngos.map((n) => ({ value: n.id, label: n.frozen ? `${n.name} (frozen)` : n.name }))} />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Invoice number">
              <Input value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} placeholder="BW-1043" />
            </Field>
            <Field label="Invoice date">
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
          </div>
          <div>
            <div className="mb-2 flex items-center justify-between text-[13px] text-graphite">
              <span>Line items</span>
              <span className="flex items-center gap-1.5">
                <CategoryIcon category={vendor.category} size={14} /> {vendor.category} (locked)
              </span>
            </div>
            <div className="flex flex-col gap-2">
              {items.map((it, i) => (
                <div key={i} className="grid grid-cols-[72px_1fr_120px_36px] gap-2">
                  <Input type="number" min="1" value={it.qty} onChange={(e) => setItems((xs) => xs.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} />
                  <Input placeholder="Item" value={it.name} onChange={(e) => setItems((xs) => xs.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                  <Input type="number" placeholder="₹ each" value={it.price} onChange={(e) => setItems((xs) => xs.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)))} />
                  <button className="grid place-items-center rounded-full border border-hairline bg-white text-ash hover:text-obsidian" onClick={() => setItems((xs) => (xs.length > 1 ? xs.filter((_, j) => j !== i) : xs))}>
                    <CrossIcon size={14} />
                  </button>
                </div>
              ))}
            </div>
            <div className="mt-3 flex items-center justify-between">
              <Button variant="ghost" className="h-9 px-4" onClick={() => setItems((xs) => [...xs, { qty: "1", name: "", price: "" }])}>
                Add line
              </Button>
              <span className="font-display text-[28px] font-normal">
                <Rupees value={total} />
              </span>
            </div>
          </div>
          <label className="flex cursor-pointer items-center gap-4 rounded-[var(--radius-tile)] border border-dashed border-hairline bg-white p-4 hover:border-ash">
            <IconOrb>
              <UploadIcon />
            </IconOrb>
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-medium">{file ? file.name : "Attach receipt photo or PDF"}</div>
              <div className="text-[13px] text-graphite">{file ? <>CID <span className="font-mono">{file.cid.slice(0, 18)}…</span></> : "Stored content-addressed; its hash is what you sign"}</div>
            </div>
            <input type="file" accept="image/*,application/pdf" className="hidden" onChange={onFile} />
          </label>
        </Card>

        <Card className="col-span-5 flex flex-col p-6">
          <div className="text-[14px] font-medium">You are signing these exact invoice fields</div>
          <div className="mt-1 text-[13px] text-graphite">Any change to these fields after signing breaks the signature on-chain.</div>
          <div className="mt-4">
            <KV k="vendor"><HashText value={address} /></KV>
            <KV k="ngoId">{ngoId}</KV>
            <KV k="invoiceNo">{typed ? <HashText value={typed.invoiceNo} /> : "—"}</KV>
            <KV k="amount">{total > 0 ? <Rupees value={total} /> : "—"}</KV>
            <KV k="date"><span className="tabular">{dateSec}</span></KV>
            <KV k="category">{category} · {vendor.category}</KV>
            <KV k="fileHash">{file ? <HashText value={file.fileHash} /> : "—"}</KV>
          </div>
          {file?.preview && file.mime?.startsWith("image/") && <img src={file.preview} alt="receipt preview" className="mt-4 max-h-40 rounded-[var(--radius-tile)] border border-hairline object-contain" />}
          {file && !file.preview && <a className="mt-4 text-[13px] underline" href={ipfsUrl(file.cid)} target="_blank" rel="noreferrer">Open stored file</a>}
          <Button variant="signal" className="mt-auto w-full" disabled={!typed || busy} onClick={sign}>
            {busy ? "Signing…" : "Sign and send to NGO"}
          </Button>
        </Card>
      </div>
    </Section>
  );
}

/// Off-ramp agents: prove each released payout was paid out to a local vendor in rupees. The signed
/// record links the bank transfer (only its hash) to the on-chain payout; a bank reference can back
/// only one payout, and a payout left unsettled past its deadline can be flagged by anyone.
function SettleFiat({ payouts }) {
  const due = payouts.filter((p) => p.status === "Released" && !p.fiat);
  const settled = payouts.filter((p) => p.fiat);
  return (
    <Section eyebrow="Fiat off-ramp" title="Settle payouts in rupees">
      <p className="mb-5 max-w-[720px] text-[14px] text-ash">
        You paid the local shop in rupees. Signing this record links that bank transfer to the on-chain payout, so donors can see their money reached the real world.
        Only hashes of the bank reference and payee go on-chain, and a bank reference can be used only once.
      </p>
      {due.length === 0 ? (
        <Empty>No released payouts waiting for a rupee settlement.</Empty>
      ) : (
        <div className="flex flex-col gap-4">
          {due.map((p) => (
            <SettleRow key={p.id} p={p} />
          ))}
        </div>
      )}
      {settled.length > 0 && (
        <div className="mt-6 overflow-hidden rounded-[var(--radius-card)] border border-hairline bg-paper">
          {settled.map((p) => (
            <div key={p.id} className="grid grid-cols-[1fr_1fr_1.4fr_1fr] items-center gap-4 border-b border-hairline px-6 py-3 text-[14px] last:border-b-0">
              <span>Payout #{p.id}</span>
              <Rupees value={p.fiat.fiatAmount} />
              <span className="text-ash">
                bank ref <HashText value={p.fiat.bankRefHash} />
              </span>
              <StatusBadge status="Active" label="Paid in rupees" />
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

const toLocalInput = (unix) => {
  const d = new Date(unix * 1000);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

function SettleRow({ p }) {
  const { c, chain, signer, tx, chainNow } = useApp("c", "chain", "signer", "tx", "chainNow");
  const [amount, setAmount] = useState(String(p.amount));
  const [bankRef, setBankRef] = useState("");
  const [payee, setPayee] = useState("");
  const [paidAt, setPaidAt] = useState(() => toLocalInput(chainNow()));
  const [busy, setBusy] = useState(false);
  const paidAtUnix = Math.floor(new Date(paidAt).getTime() / 1000);
  // the contract accepts a payment made after the release and not in the future (minute precision here)
  const timeOk = paidAtUnix + 60 >= (p.releasedAt ?? 0) && paidAtUnix <= chainNow() + 60;
  const ok = Number(amount) > 0 && Number(amount) <= p.amount && bankRef.trim() && payee.trim() && timeOk;

  async function settle() {
    setBusy(true);
    try {
      // the picker has minute precision: keep the timestamp inside [release, now] as the contract requires
      const at = Math.min(Math.max(paidAtUnix, p.releasedAt ?? 0), chainNow());
      const { value, signature } = await chain.signFiatSettlement(signer, { payoutId: p.id, fiatAmount: Number(amount), bankRef, payee, paidAt: at });
      await tx(`Settle payout #${p.id} in rupees`, () => c.vault.attestFiat(value, signature));
    } catch {
      // toasted
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="text-[16px] font-medium">
          Payout #{p.id} · <Rupees value={p.amount} />
        </div>
        <span className="text-[14px] text-ash">
          settle within <Countdown until={p.fiatDeadline} done="overdue — anyone can flag it" />
        </span>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <Field label="Rupees paid (₹)" hint={`At most ₹${p.amount.toLocaleString("en-IN")}`}>
          <Input type="number" min="1" max={p.amount} value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="Bank transfer reference (UTR)" hint="Only its hash goes on-chain.">
          <Input value={bankRef} onChange={(e) => setBankRef(e.target.value)} placeholder="e.g. SBIN526318804211" />
        </Field>
        <Field label="Paid to (local vendor)" hint="Only its hash goes on-chain.">
          <Input value={payee} onChange={(e) => setPayee(e.target.value)} placeholder="Shop or account name" />
        </Field>
        <Field label="Paid on" hint={timeOk ? "After the release, not in the future." : "Must be after the release and not in the future."}>
          <Input type="datetime-local" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
        </Field>
      </div>
      <Button className="mt-5" disabled={!ok || busy} onClick={settle}>
        {busy ? "Signing…" : "Sign and record the rupee payment"}
      </Button>
    </Card>
  );
}
