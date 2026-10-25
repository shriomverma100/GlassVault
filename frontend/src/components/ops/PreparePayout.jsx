import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { api, ipfsUrl } from "../../lib/api";
import { useApp } from "../../lib/store";
import { CATEGORIES, fromWei, toWei } from "../../lib/chain";
import { labeler } from "../../lib/derive";
import { liquid } from "../../lib/motion";
import { Button, Card, Field, HashText, Input, Rupees } from "../ui/kit";
import { CategoryIcon } from "../icons";
import { CheckRow, FRAUD_REASONS, humanize, sameAddr, useApiList, useReceiptCid } from "./shared";

/// FIFO allocation across this NGO's open lots of the right category.
function allocate(lots, amount) {
  let left = Number(amount) || 0;
  const shares = [];
  for (const l of lots) {
    if (left <= 0) break;
    const take = Math.min(l.remaining, left);
    shares.push({ lotId: l.id, amount: take });
    left -= take;
  }
  return shares;
}

export default function PreparePayout({ ngo, invoice, onDone }) {
  const { state, config, chain, c, tx, toast, chainNow } = useApp("state", "config", "chain", "c", "tx", "toast", "chainNow");
  const nameOf = useMemo(() => labeler(config), [config]);
  const category = CATEGORIES[invoice.category];
  const [amount, setAmount] = useState(String(invoice.amount));
  const openLots = useMemo(
    () => state.lots.filter((l) => l.ngoId === ngo.id && l.category === category && l.remaining > 0 && l.deadline > chainNow()).sort((a, b) => a.id - b.id),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.lots, ngo.id, category],
  );
  const [shares, setShares] = useState(() => allocate(openLots, invoice.amount));
  const lotsKey = openLots.map((l) => `${l.id}:${l.remaining}`).join(",");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setShares(allocate(openLots, amount)), [amount, lotsKey]);

  // Only lists attested on-chain by an independent field partner for THIS NGO can back a payout — the NGO
  // can't issue its own beneficiaries. Labels come from the off-chain index; the attestation is on-chain.
  const [published] = useApiList(`/api/beneficiaries?ngoId=${ngo.id}`);
  const labels = useMemo(() => new Map(published.map((b) => [b.root.toLowerCase(), b.label])), [published]);
  const batches = useMemo(() => (state.batches ?? []).filter((b) => b.ngoId === ngo.id), [state.batches, ngo.id]);
  const [root, setRoot] = useState(null);
  const [rootCount, setRootCount] = useState(0); // cards in the chosen batch — the most deliveries it can ever prove
  const [required, setRequired] = useState(1);
  const pickBatch = (r, count) => {
    setRoot(r);
    setRootCount(count);
    setRequired(count);
  };
  // one batch proves one payout: the contract rejects a beneficiary root that already backs a payout
  const usedRoots = useMemo(() => new Map(state.payouts.map((p) => [p.beneficiaryRoot.toLowerCase(), p.id])), [state.payouts]);
  const rootUsedBy = root ? usedRoots.get(root.toLowerCase()) : undefined;
  const [busy, setBusy] = useState(false);
  const cid = useReceiptCid(invoice.fileHash, invoice);

  const fields = { vendor: invoice.vendor, ngoId: ngo.id, invoiceNo: invoice.invoiceNo, amount: amount || "0", date: invoice.date, category: invoice.category, fileHash: invoice.fileHash };

  // ── live pre-checks — exactly what the contract will verify ──
  const signer = Number(amount) > 0 ? chain.recoverInvoiceSigner(fields, invoice.signature) : null;
  const sigOk = sameAddr(signer, invoice.vendor);
  const vendor = state.vendors.find((v) => sameAddr(v.address, invoice.vendor));
  const vendorOk = !!vendor?.registered && vendor.category === category;
  const [nullifierUsed, setNullifierUsed] = useState(null);
  useEffect(() => {
    if (!(Number(amount) > 0)) return setNullifierUsed(null);
    let live = true;
    setNullifierUsed(null);
    c.vault.nullifierToPayout(chain.invoiceNullifier(fields)).then((v) => live && setNullifierUsed(v !== 0n)).catch(() => live && setNullifierUsed(null));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amount, invoice.id, state.updatedAt]);
  const sum = shares.reduce((s, x) => s + Number(x.amount || 0), 0);
  const withinBudget = shares.every((s) => {
    const lot = state.lots[s.lotId];
    return lot && lot.ngoId === ngo.id && lot.category === category && Number(s.amount) <= lot.remaining;
  });
  const budgetOk = shares.length > 0 && Math.abs(sum - Number(amount)) < 1e-9 && withinBudget;
  const impactOk = !!root && rootUsedBy === undefined && required > 0 && required <= rootCount;
  const allOk = sigOk && vendorOk && nullifierUsed === false && budgetOk && impactOk;

  /// The indexer view can lag a block behind. Re-read every charged lot from the chain; if a share
  /// that fitted the shown balance no longer fits, re-allocate instead of sending a stale request.
  async function sharesStillFit() {
    const charged = shares.filter((s) => Number(s.amount) > 0);
    const fresh = await Promise.all(charged.map((s) => c.vault.lot(s.lotId).then((l) => fromWei(l.remaining))));
    const stale = charged.some((s, i) => Number(s.amount) <= (state.lots[s.lotId]?.remaining ?? 0) && Number(s.amount) > fresh[i]);
    if (!stale) return true;
    const freshById = new Map(charged.map((s, i) => [s.lotId, fresh[i]]));
    setShares(allocate(openLots.map((l) => ({ ...l, remaining: freshById.get(l.id) ?? l.remaining })), amount));
    toast({ title: "Donor lots changed", body: "Another payout reserved part of these lots. Shares were re-allocated from the live balances — review and submit again.", tone: "error", ms: 8000 });
    return false;
  }

  async function submit() {
    if (!root) return toast({ title: "Impact proof required", body: "Pick a beneficiary list attested by a field partner — root ④ is mandatory.", tone: "error" });
    if (rootUsedBy !== undefined) return toast({ title: "List already used", body: `These cards already prove payout #${rootUsedBy}. Ask a field partner for a fresh list.`, tone: "error" });
    setBusy(true);
    try {
      if (!(await sharesStillFit())) return;
      const rc = await tx(`Request payout · ${invoice.invoiceNo}`, () =>
        c.vault.requestPayout(
          chain.typedInvoice(fields),
          invoice.signature,
          shares.filter((s) => Number(s.amount) > 0).map((s) => ({ lotId: s.lotId, amount: toWei(s.amount) })),
          root,
          required,
        ),
      );
      const parsed = rc.logs.map((l) => { try { return c.vault.interface.parseLog(l); } catch { return null; } }).filter(Boolean);
      const flag = parsed.find((p) => p.name === "FraudFlagged");
      const discrepancy = parsed.find((p) => p.name === "Discrepancy");
      const slashed = parsed.find((p) => p.name === "VendorSlashed");
      const req = parsed.find((p) => p.name === "PayoutRequested");
      if (slashed) {
        toast({ title: "Vendor slashed", body: "The vendor signed these exact invoice fields for another NGO. Its stake was slashed; this NGO is not flagged.", tone: "error", ms: 9000 });
        await api.post(`/api/invoices/${invoice.id}/status`, { status: "flagged", txHash: rc.hash });
      } else if (discrepancy) {
        const reason = humanize(FRAUD_REASONS[Number(discrepancy.args.reason)]);
        toast({ title: `Payout rejected: ${reason}`, body: "Recorded on-chain as a discrepancy. It does not count toward a freeze — fix the shares and try again.", tone: "error", ms: 9000 });
      } else if (flag) {
        const reason = humanize(FRAUD_REASONS[Number(flag.args.reason)]);
        const frozen = parsed.some((p) => p.name === "NGOFrozen");
        toast({ title: `Fraud recorded: ${reason}`, body: frozen ? "Second flag — the contract froze this NGO." : `Flag ${flag.args.flagCount} of 2 before automatic freeze.`, tone: "error", ms: 9000 });
        await api.post(`/api/invoices/${invoice.id}/status`, { status: "flagged", txHash: rc.hash });
      } else if (req) {
        toast({ title: `Payout #${req.args.payoutId} opened`, body: "Challenge window is running. Funds reserved from donor lots.", tone: "ok" });
        await api.post(`/api/invoices/${invoice.id}/status`, { status: "submitted", txHash: rc.hash });
      }
      onDone?.();
    } catch {
      // tx() already toasted the revert reason
    } finally {
      setBusy(false);
    }
  }

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={liquid} className="grid grid-cols-12 gap-6">
      {/* receipt + fields */}
      <Card className="col-span-4 overflow-hidden">
        <div className="flex items-center justify-between border-b border-hairline px-5 py-4">
          <span className="flex items-center gap-2 text-[14px] font-medium">
            <CategoryIcon category={category} /> {invoice.invoiceNo}
          </span>
          <HashText value={invoice.fileHash} />
        </div>
        {cid ? (
          <a href={ipfsUrl(cid)} target="_blank" rel="noreferrer" className="block bg-white">
            <img src={ipfsUrl(cid)} alt={`Receipt ${invoice.invoiceNo}`} className="max-h-[360px] w-full object-contain" />
          </a>
        ) : (
          <div className="grid h-48 place-items-center bg-white px-6 text-center text-[13px] text-graphite">Receipt file is anchored on-chain by its hash; image preview not indexed yet.</div>
        )}
        <div className="space-y-1 px-5 py-4 text-[13px]">
          {(invoice.lineItems ?? []).map((li, i) => (
            <div key={i} className="flex justify-between">
              <span>
                {li.qty} × {li.name}
              </span>
              <Rupees value={li.qty * li.price} />
            </div>
          ))}
          <div className="flex justify-between border-t border-hairline pt-2 font-medium">
            <span>Vendor signed</span>
            <Rupees value={invoice.amount} />
          </div>
        </div>
      </Card>

      {/* allocation + impact */}
      <div className="col-span-5 flex flex-col gap-6">
        <Card className="p-5">
          <Field label="Amount to request" hint={Number(amount) !== invoice.amount ? "Differs from what the vendor signed — the signature will not verify." : "Matches the vendor's signed amount."}>
            <Input type="number" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <div className="mt-5 text-[13px] text-graphite">Charged to donor lots (FIFO, editable)</div>
          <div className="mt-2 divide-y divide-hairline rounded-[var(--radius-tile)] border border-hairline bg-white">
            {shares.length === 0 && <div className="p-4 text-[13px] text-graphite">No open {category} lots for this NGO.</div>}
            {shares.map((s, i) => {
              const lot = state.lots[s.lotId];
              return (
                <div key={s.lotId} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <div className="text-[13px]">
                    Lot #{s.lotId} <span className="text-graphite">· <Rupees value={lot?.remaining} /> left</span>
                    {lot?.sourceChain !== 31337 && <span className="ml-2 text-[12px] text-graphite">bridged</span>}
                  </div>
                  <Input
                    type="number"
                    className="h-9 w-32 text-right"
                    value={s.amount}
                    onChange={(e) => setShares((xs) => xs.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))}
                  />
                </div>
              );
            })}
          </div>
          <div className="mt-2 flex justify-between text-[13px]">
            <span className="text-graphite">Shares total</span>
            <Rupees value={sum} />
          </div>
        </Card>

        <Card className="p-5">
          <div className="text-[14px] font-medium">Impact proof — beneficiary list</div>
          <div className="mt-1 text-[13px] text-graphite">
            Issued and attested by an independent field partner — you can't add your own beneficiaries. Only the list's fingerprint is on-chain, no names. The last 30% is
            paid after this many cards confirm delivery.
          </div>
          <div className="mt-4 flex flex-col gap-2">
            {batches.map((b) => {
              const usedBy = usedRoots.get(b.root.toLowerCase());
              return (
                <button
                  key={b.root}
                  disabled={usedBy !== undefined}
                  onClick={() => pickBatch(b.root, b.cards)}
                  className={`flex items-center justify-between rounded-full border px-4 py-2 text-left text-[13px] disabled:cursor-not-allowed ${
                    usedBy !== undefined ? "border-dashed border-hairline bg-paper text-ash" : root === b.root ? "border-obsidian bg-signal-mist" : "border-hairline bg-white"
                  }`}
                >
                  <span>{labels.get(b.root.toLowerCase()) || "Beneficiary list"}</span>
                  <span className="text-ash">
                    {usedBy !== undefined ? `used by payout #${usedBy}` : `attested by ${nameOf(b.partner)} · ${b.cards} cards`}
                  </span>
                </button>
              );
            })}
          </div>
          {batches.every((b) => usedRoots.has(b.root.toLowerCase())) && (
            <div className="mt-2 rounded-[var(--radius-tile)] border border-dashed border-hairline bg-white p-3 text-[13px] text-ash">
              {batches.length ? "Every attested list already proves another payout." : "No beneficiary list attested for your NGO yet."} Ask a field partner to issue cards
              for your NGO.
            </div>
          )}
          {root && (
            <div className="mt-4 flex items-center gap-3">
              <Field label="Deliveries required" hint={`1–${rootCount}: a batch can't prove more deliveries than it has cards`}>
                <Input
                  type="number"
                  min="1"
                  max={rootCount}
                  className="w-24"
                  value={required}
                  onChange={(e) => setRequired(Math.min(rootCount, Math.max(1, Math.floor(Number(e.target.value) || 1))))}
                />
              </Field>
              <div className="text-[13px] text-graphite">
                root <HashText value={root} />
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* pre-checks + submit */}
      <Card className="col-span-3 flex flex-col p-5">
        <div className="text-[14px] font-medium">Live pre-checks</div>
        <div className="mt-1 text-[13px] text-graphite">The same rules the contract enforces.</div>
        <div className="mt-3">
          <CheckRow ok={sigOk} label="Vendor signature" detail={sigOk ? "EIP-712 signature matches these exact fields" : "These fields were not signed by the vendor"} />
          <CheckRow ok={vendorOk} label="Registered vendor, right category" detail={vendor ? `${vendor.category} · stake ₹${vendor.stake.toLocaleString("en-IN")}` : "Vendor not registered"} />
          <CheckRow ok={nullifierUsed === false} pending={nullifierUsed === null} label="Invoice never used before" detail={nullifierUsed ? "Nullifier already on-chain — duplicate" : "Global nullifier check across all NGOs"} />
          <CheckRow ok={budgetOk} label="Within donor budgets" detail={budgetOk ? "Shares add up and stay inside each lot" : "Shares must equal the amount and fit each lot"} />
          <CheckRow
            ok={impactOk}
            label="Beneficiary list attested by an independent field partner"
            detail={impactOk ? `${required} card confirmations required` : rootUsedBy !== undefined ? `List already proves payout #${rootUsedBy} — ask for a fresh one` : "Pick a list a field partner attested for you"}
          />
        </div>
        <div className="mt-auto pt-5">
          {!allOk && (
            <div className="hatch mb-3 rounded-[var(--radius-tile)] border border-obsidian bg-white p-3 text-[13px]">
              Failing checks are not blocked. A bad signature, a reused invoice or a wrong vendor is <b>recorded on-chain as fraud</b> — two flags freeze this NGO
              automatically. Budget mismatches are rejected as discrepancies.
            </div>
          )}
          <Button variant={allOk ? "signal" : "danger"} className="w-full" disabled={busy || ngo.frozen} onClick={submit}>
            {busy ? "Submitting…" : allOk ? "Request payout" : "Submit anyway"}
          </Button>
        </div>
      </Card>

    </motion.div>
  );
}

