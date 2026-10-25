import { useEffect, useId, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ethers } from "ethers";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import { Html5Qrcode } from "html5-qrcode";
import { api } from "../lib/api";
import { useApp } from "../lib/store";
import { cardBatch, cardFromKey } from "../lib/chain";
import { labeler } from "../lib/derive";
import { fadeUp, liquid, stagger } from "../lib/motion";
import { Button, Card, Drawer, Empty, Field as FormField, HashText, Input, Rupees, Section, Segmented, StatusBadge, RoleGate } from "../components/ui/kit";
import { IconOrb } from "../components/ui/primitives";
import { CategoryIcon, CheckIcon, QrIcon } from "../components/icons";
import { ProgressRing, QrCards, sameAddr } from "../components/ops/shared";
import { Ring } from "../components/viz";

export default function Field() {
  return (
    <RoleGate kinds={["Field"]}>
      <Workspace />
    </RoleGate>
  );
}

function Workspace() {
  const { state, address } = useApp("state", "address");
  const partner = (state.fieldPartners ?? []).find((p) => sameAddr(p.address, address));
  const open = state.payouts.filter((p) => ["Pending", "Released"].includes(p.status) && p.deliveries < p.deliveriesRequired && !state.ngos[p.ngoId]?.frozen);
  const [payoutId, setPayoutId] = useState(open[0]?.id ?? null);
  const payout = state.payouts.find((p) => p.id === payoutId);

  return (
    <motion.div variants={stagger()} initial="hidden" animate="show">
      <motion.section variants={fadeUp} className="pt-10 pb-8">
        <span className="text-[13px] text-graphite">④ Cryptographic impact verification</span>
        <h1 className="font-display text-[56px] leading-none font-normal tracking-tight">Field partner</h1>
        <p className="mt-3 max-w-[680px] text-[14px] text-ash">
          You issue beneficiaries their QR cards and confirm each handover. You are independent of the NGO: an NGO can't approve its own beneficiary list or confirm its
          own deliveries. Each card holds its own key and signs the delivery — the person's identity never leaves the card.
        </p>
      </motion.section>

      {state.payouts.some((p) => p.status !== "Cancelled") && (
        <motion.div variants={fadeUp}>
          <Section tour="field-progress" eyebrow="Proof of delivery" title="Handovers confirmed, per payout">
            <div className="flex flex-wrap gap-6">
              {state.payouts
                .filter((p) => p.status !== "Cancelled")
                .slice(-10)
                .map((p) => (
                  <Ring key={p.id} value={p.deliveries} max={p.deliveriesRequired} label={`#${p.id} · ${state.ngos[p.ngoId]?.name ?? "NGO"}`} />
                ))}
            </div>
          </Section>
        </motion.div>
      )}

      <motion.div variants={fadeUp} data-tour="field-cards">
        {partner?.registered ? <IssueCards partner={partner} /> : <RegisterPartner slashed={!!partner && !partner.registered} />}
      </motion.div>

      <motion.div variants={fadeUp}>
        <Section tour="field-confirm" eyebrow="Confirm a delivery · step 1" title="Which delivery?">
          {open.length === 0 ? (
            <Empty>No payouts are waiting for beneficiary confirmations.</Empty>
          ) : (
            <div className="grid grid-cols-3 gap-3">
              {open.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setPayoutId(p.id)}
                  className={`rounded-[var(--radius-tile)] border p-5 text-left transition-colors ${p.id === payoutId ? "border-obsidian bg-signal-mist" : "border-hairline bg-paper hover:border-ash/40"}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-2 text-[14px] font-medium">
                      <CategoryIcon category={p.category} /> Payout #{p.id}
                    </span>
                    <StatusBadge status={p.status} />
                  </div>
                  <div className="mt-3 text-[13px] text-graphite">
                    {state.ngos[p.ngoId]?.name} · <Rupees value={p.amount} />
                  </div>
                  <div className="mt-1 text-[13px]">
                    {p.deliveries}/{p.deliveriesRequired} delivered
                  </div>
                </button>
              ))}
            </div>
          )}
        </Section>
      </motion.div>

      {payout && (
        <motion.div variants={fadeUp}>
          <Confirm key={payout.id} payout={payout} />
        </motion.div>
      )}
    </motion.div>
  );
}

/// First step for a field partner: stake to be allowed to attest beneficiary lists. Attesting fake lists
/// puts that stake at risk, so an NGO can't cheaply invent its own beneficiaries through a partner.
function RegisterPartner({ slashed }) {
  const { c, tx, user } = useApp("c", "tx", "user");
  const [busy, setBusy] = useState(false);
  if (slashed) return <Empty>This field-partner wallet was slashed and can no longer attest beneficiary lists.</Empty>;
  async function go() {
    setBusy(true);
    try {
      const stake = await c.vault.FIELD_STAKE();
      await tx("Approve ₹2,000 field-partner stake", () => c.dinr.approve(c.vault.target, stake));
      await tx("Register field partner", () => c.vault.registerFieldPartner(ethers.id(user.displayName)));
    } catch {
      // toasted
    } finally {
      setBusy(false);
    }
  }
  return (
    <Section eyebrow="Step 1 of your field-partner account" title="Register as a field partner">
      <Card className="max-w-[640px] p-8">
        <p className="text-[15px] text-ash">
          Registering locks a <span className="font-medium text-obsidian">₹2,000 stake</span>. Only registered partners can attest beneficiary lists, so an NGO can't
          approve its own beneficiaries.
        </p>
        <Button className="mt-6" disabled={busy} onClick={go}>
          {busy ? "Registering…" : "Stake and register"}
        </Button>
      </Card>
    </Section>
  );
}

/// Issue a batch of beneficiary cards for an NGO. Keys are generated in this browser and printed; only
/// the list's fingerprint (Merkle root) and card addresses leave it, and the partner attests it on-chain.
function IssueCards({ partner }) {
  const { state, config, c, tx, toast } = useApp("state", "config", "c", "tx", "toast");
  const ngos = state.ngos.filter((n) => !n.frozen);
  const [ngoId, setNgoId] = useState(ngos[0]?.id ?? null);
  const [label, setLabel] = useState("");
  const [count, setCount] = useState("5");
  const [busy, setBusy] = useState(false);
  const [printed, setPrinted] = useState(null);
  const nameOf = useMemo(() => labeler(config), [config]);
  const mine = (state.batches ?? []).filter((b) => sameAddr(b.partner, partner.address));
  const usedBy = useMemo(() => new Map(state.payouts.map((p) => [p.beneficiaryRoot.toLowerCase(), p.id])), [state.payouts]);

  async function issue() {
    const n = Math.floor(Number(count));
    if (!(n > 0) || ngoId === null) return;
    setBusy(true);
    try {
      const batch = cardBatch(n);
      const name = label.trim() || `${state.ngos[ngoId]?.name} beneficiaries`;
      await api.post("/api/beneficiaries", { ngoId, label: name, dump: batch.dump });
      await tx(`Attest ${n} beneficiary cards for ${state.ngos[ngoId]?.name}`, () => c.vault.attestBatch(batch.root, ngoId, n));
      // keys exist only here, now: printed once, then gone when the panel closes
      setPrinted({ label: name, cards: batch.wallets.map((w, i) => ({ n: i + 1, secret: w.privateKey })) });
      setLabel("");
    } catch (e) {
      if (!e?.code) toast({ title: "Could not issue cards", body: e.message, tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section eyebrow="Issue beneficiary cards" title="Cards for an NGO's beneficiaries">
      <div className="grid grid-cols-12 gap-6">
        <Card className="col-span-7 p-6">
          <p className="text-[14px] text-ash">
            Keys are created here and printed on the cards; the server and the NGO only ever see the list's fingerprint and card addresses — never a name.
          </p>
          <div className="mt-5 flex flex-col gap-4">
            <FormField label="NGO">
              <Segmented id="field-ngo" value={ngoId} onChange={setNgoId} options={ngos.map((n) => ({ value: n.id, label: n.name }))} />
            </FormField>
            <div className="flex flex-wrap items-end gap-3">
              <FormField label="Batch label">
                <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Wadgaon households" />
              </FormField>
              <FormField label="Number of cards">
                <Input type="number" min="1" max="200" className="w-24" value={count} onChange={(e) => setCount(e.target.value)} />
              </FormField>
              <Button disabled={busy || ngoId === null} onClick={issue}>
                {busy ? "Issuing…" : "Issue cards"}
              </Button>
            </div>
          </div>
        </Card>
        <Card className="col-span-5 p-6">
          <div className="text-[14px] font-medium">Lists you attested</div>
          {mine.length === 0 ? (
            <div className="mt-3 text-[14px] text-ash">None yet.</div>
          ) : (
            <ul className="mt-3 divide-y divide-hairline">
              {mine.map((b) => {
                const used = usedBy.get(b.root.toLowerCase());
                return (
                  <li key={b.root} className="flex items-center justify-between gap-3 py-2.5 text-[14px]">
                    <span>
                      {state.ngos[b.ngoId]?.name ?? `NGO #${b.ngoId}`} · {b.cards} cards
                    </span>
                    <span className="text-[13px] text-ash">{used !== undefined ? `proves payout #${used}` : "not used yet"}</span>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="mt-3 text-[13px] text-graphite">Attested on-chain by {nameOf(partner.address)}</div>
        </Card>
      </div>
      <Drawer open={!!printed} onClose={() => setPrinted(null)} title="Beneficiary QR cards">
        {printed && <QrCards cards={printed.cards} label={printed.label} />}
        <Button variant="ghost" className="mt-4" onClick={() => window.print()}>
          Print cards
        </Button>
      </Drawer>
    </Section>
  );
}

function Confirm({ payout }) {
  const { c, chain, tx, toast } = useApp("c", "chain", "tx", "toast");
  const [tree, setTree] = useState(null);
  const [treeError, setTreeError] = useState(null);
  const [key, setKey] = useState(""); // card key: lives only in this input, never stored or sent
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);

  useEffect(() => {
    api
      .get(`/api/beneficiaries/${payout.beneficiaryRoot}`)
      .then((t) => setTree(StandardMerkleTree.load(t.dump)))
      .catch(() => setTreeError("This payout's beneficiary list is not published — cards cannot be verified."));
  }, [payout.beneficiaryRoot]);

  // check the card against the approved list as soon as a key is scanned or pasted
  const check = useMemo(() => {
    if (!tree || !key) return null;
    const card = cardFromKey(key);
    if (!card) return { ok: false, msg: "Not a GlassVault card (expected a card key)." };
    for (const [i, [addr]] of tree.entries()) {
      if (addr.toLowerCase() === card.address.toLowerCase()) return { ok: true, msg: "Card is on this payout's approved list.", card, proof: tree.getProof(i) };
    }
    return { ok: false, msg: "Card not in this payout's beneficiary list." };
  }, [tree, key]);

  async function confirm() {
    setBusy(true);
    try {
      // the card signs "I received payout #id" — only the signature goes on-chain, never the key
      const sig = await chain.signDelivery(check.card, payout.id);
      const rc = await tx(`Confirm delivery · payout #${payout.id}`, () => c.vault.confirmDelivery(payout.id, sig, check.proof));
      const parsed = rc.logs
        .map((l) => {
          try {
            return c.vault.interface.parseLog(l);
          } catch {
            return null;
          }
        })
        .filter(Boolean);
      const ev = parsed.find((p) => p.name === "DeliveryConfirmed");
      const impact = parsed.some((p) => p.name === "ImpactVerified");
      setDone({ deliveries: Number(ev?.args.deliveries ?? payout.deliveries + 1), required: payout.deliveriesRequired, impact });
      if (impact) toast({ title: "Impact verified", body: "Final 30% released to the vendor. Donors received Proof-of-Impact tokens.", tone: "ok" });
      setKey("");
    } catch {
      // toasted
    } finally {
      setBusy(false);
    }
  }

  const shown = done ?? { deliveries: payout.deliveries, required: payout.deliveriesRequired };

  return (
    <Section eyebrow="Confirm a delivery · step 2" title="Scan the card">
      <div className="grid grid-cols-12 gap-6">
        <Card className="col-span-5 p-6">
          {treeError ? <Empty>{treeError}</Empty> : <Scanner onSecret={setKey} />}
          <div className="mt-4">
            <FormField label="Or paste the card key">
              <Input className="font-mono" placeholder="0x…" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value.trim())} />
            </FormField>
          </div>
        </Card>

        <Card className="col-span-7 flex items-center gap-10 p-8">
          <ProgressRing value={shown.deliveries} max={shown.required} size={160} label="delivered" />
          <div className="min-w-0 flex-1">
            <AnimatePresence mode="wait">
              {done && !key ? (
                <motion.div key="done" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={liquid}>
                  <div className="flex items-center gap-3">
                    <span className="grid h-12 w-12 place-items-center rounded-full bg-signal">
                      <CheckIcon size={24} />
                    </span>
                    <span className="font-display text-[32px] font-normal">Delivery proven</span>
                  </div>
                  <p className="mt-3 text-[14px] text-ash">
                    {done.impact
                      ? "All confirmations in — the contract paid the final 30% and minted Proof-of-Impact tokens to the donors."
                      : `${done.required - done.deliveries} more card(s) to go before the final 30% unlocks.`}
                  </p>
                </motion.div>
              ) : (
                <motion.div key="check" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={liquid}>
                  <div className="text-[13px] text-graphite">Payout #{payout.id} · approved list fingerprint</div>
                  <HashText value={payout.beneficiaryRoot} n={8} />
                  {check ? (
                    <div className={`mt-4 rounded-[var(--radius-tile)] border p-4 text-[14px] ${check.ok ? "border-signal-deep bg-signal-mist" : "hatch border-obsidian bg-white"}`}>
                      {check.msg}
                      {check.card && (
                        <div className="mt-1 text-[13px] text-graphite">
                          card <HashText value={check.card.address} /> · the card signs; its key stays on the card
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="mt-4 text-[14px] text-graphite">Waiting for a card…</div>
                  )}
                  <Button variant="signal" className="mt-5" disabled={!check?.ok || busy} onClick={confirm}>
                    {busy ? "Confirming…" : "Confirm handover on-chain"}
                  </Button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </Card>
      </div>
    </Section>
  );
}

/// Camera QR scanner. Stops itself after the first successful read.
function Scanner({ onSecret }) {
  const id = `qr-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const qr = useRef(null);
  const [on, setOn] = useState(false);
  const [err, setErr] = useState(null);

  const stop = async () => {
    try {
      if (qr.current?.isScanning) await qr.current.stop();
    } catch {
      // already stopped
    }
    setOn(false);
  };

  useEffect(() => () => void stop(), []);

  async function start() {
    setErr(null);
    try {
      qr.current ??= new Html5Qrcode(id, { verbose: false });
      setOn(true);
      await qr.current.start({ facingMode: "environment" }, { fps: 10, qrbox: 220 }, (text) => {
        onSecret(text.trim());
        stop();
      });
    } catch (e) {
      setOn(false);
      setErr(String(e?.message ?? e).includes("Permission") ? "Camera permission denied." : "No camera available — paste the card key instead.");
    }
  }

  return (
    <div>
      <div className="relative aspect-square overflow-hidden rounded-[var(--radius-tile)] border border-hairline bg-white">
        <div id={id} className="h-full w-full" />
        {!on && (
          <div className="absolute inset-0 grid place-items-center">
            <div className="flex flex-col items-center gap-3 text-center">
              <IconOrb size={64}>
                <QrIcon size={28} />
              </IconOrb>
              <span className="text-[13px] text-graphite">{err ?? "Point the camera at the beneficiary's card"}</span>
            </div>
          </div>
        )}
        {/* corner brackets */}
        {["top-3 left-3 border-t border-l", "top-3 right-3 border-t border-r", "bottom-3 left-3 border-b border-l", "bottom-3 right-3 border-b border-r"].map((p) => (
          <span key={p} className={`pointer-events-none absolute h-6 w-6 border-obsidian ${p}`} />
        ))}
      </div>
      <Button variant={on ? "ghost" : "primary"} className="mt-4 w-full" onClick={on ? stop : start}>
        {on ? "Stop camera" : "Start camera"}
      </Button>
    </div>
  );
}
