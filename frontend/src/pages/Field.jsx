import { useEffect, useId, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ethers } from "ethers";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import { Html5Qrcode } from "html5-qrcode";
import { api } from "../lib/api";
import { useApp } from "../lib/store";
import { fadeUp, liquid, stagger } from "../lib/motion";
import { Button, Card, Empty, Field as FormField, HashText, Input, Rupees, Section, StatusBadge } from "../components/ui/kit";
import { IconOrb } from "../components/ui/primitives";
import { CategoryIcon, CheckIcon, QrIcon } from "../components/icons";
import { ProgressRing } from "../components/ops/shared";

const coder = ethers.AbiCoder.defaultAbiCoder();

export default function Field() {
  const { state, role } = useApp("state", "role");
  const open = state.payouts.filter((p) => ["Pending", "Released"].includes(p.status) && p.deliveries < p.deliveriesRequired && !state.ngos[p.ngoId]?.frozen);
  const [payoutId, setPayoutId] = useState(open[0]?.id ?? null);
  const payout = state.payouts.find((p) => p.id === payoutId);

  return (
    <motion.div variants={stagger()} initial="hidden" animate="show">
      <motion.section variants={fadeUp} className="pt-10 pb-8">
        <span className="text-[13px] text-graphite">④ Cryptographic impact verification</span>
        <h1 className="font-display text-[56px] leading-none font-normal tracking-tight">Field delivery</h1>
        <p className="mt-3 max-w-[640px] text-[14px] text-ash">
          Scan a beneficiary's QR card at handover. The chain checks the card against the NGO's Merkle root and burns a delivery nullifier — the person's identity
          never leaves the card.
        </p>
        {role !== "fieldWorker" && <div className="mt-3 text-[13px] text-graphite">Tip: switch role to Field worker. Any wallet can confirm, the card secret is the proof.</div>}
      </motion.section>

      <motion.div variants={fadeUp}>
        <Section eyebrow="Step 1" title="Which delivery?">
          {open.length === 0 ? (
            <Empty>No payouts are waiting for beneficiary confirmations.</Empty>
          ) : (
            <div className="grid grid-cols-3 gap-3">
              {open.map((p) => (
                <motion.button
                  key={p.id}
                  whileHover={{ y: -2 }}
                  onClick={() => setPayoutId(p.id)}
                  className={`rounded-[var(--radius-tile)] border p-5 text-left ${p.id === payoutId ? "border-obsidian bg-signal-mist" : "border-hairline bg-paper"}`}
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
                </motion.button>
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

function Confirm({ payout }) {
  const { c, tx, toast } = useApp("c", "tx", "toast");
  const [tree, setTree] = useState(null);
  const [treeError, setTreeError] = useState(null);
  const [secret, setSecret] = useState("");
  const [check, setCheck] = useState(null); // { ok, msg, proof }
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);

  useEffect(() => {
    api
      .get(`/api/beneficiaries/${payout.beneficiaryRoot}`)
      .then((t) => setTree(StandardMerkleTree.load(t.dump)))
      .catch(() => setTreeError("This payout's beneficiary list is not published — cards cannot be verified."));
  }, [payout.beneficiaryRoot]);

  // validate the card against the tree as soon as a secret is entered/scanned
  useEffect(() => {
    if (!tree || !secret) return setCheck(null);
    if (!ethers.isHexString(secret, 32)) return setCheck({ ok: false, msg: "Not a GlassVault card (expected a 32-byte secret)." });
    const commitment = ethers.keccak256(coder.encode(["bytes32"], [secret]));
    let proof;
    try {
      proof = tree.getProof([commitment]);
    } catch {
      return setCheck({ ok: false, msg: "Card not in this payout's beneficiary list." });
    }
    const nullifier = ethers.keccak256(coder.encode(["uint256", "bytes32"], [payout.id, commitment]));
    let live = true;
    c.vault.deliveryUsed(nullifier).then((used) => live && setCheck(used ? { ok: false, msg: "This card already confirmed this delivery." } : { ok: true, msg: "Card is on the list and unused.", proof, commitment }));
    return () => {
      live = false;
    };
  }, [tree, secret, payout.id, c]);

  async function confirm() {
    setBusy(true);
    try {
      const rc = await tx(`Confirm delivery · payout #${payout.id}`, () => c.vault.confirmDelivery(payout.id, secret, check.proof));
      const parsed = rc.logs.map((l) => { try { return c.vault.interface.parseLog(l); } catch { return null; } }).filter(Boolean);
      const ev = parsed.find((p) => p.name === "DeliveryConfirmed");
      const impact = parsed.some((p) => p.name === "ImpactVerified");
      setDone({ deliveries: Number(ev?.args.deliveries ?? payout.deliveries + 1), required: payout.deliveriesRequired, impact });
      if (impact) toast({ title: "Impact verified", body: "Final 30% released to the vendor. Donors received Proof-of-Impact tokens.", tone: "ok" });
      setSecret("");
    } catch {
      // toasted
    } finally {
      setBusy(false);
    }
  }

  const shown = done ?? { deliveries: payout.deliveries, required: payout.deliveriesRequired };

  return (
    <Section eyebrow="Step 2" title="Scan the card">
      <div className="grid grid-cols-12 gap-6">
        <Card className="col-span-5 p-6">
          {treeError ? <Empty>{treeError}</Empty> : <Scanner onSecret={setSecret} />}
          <div className="mt-4">
            <FormField label="Or paste the card secret">
              <Input className="font-mono" placeholder="0x…" value={secret} onChange={(e) => setSecret(e.target.value.trim())} />
            </FormField>
          </div>
        </Card>

        <Card className="col-span-7 flex items-center gap-10 p-8">
          <ProgressRing value={shown.deliveries} max={shown.required} size={160} label="delivered" />
          <div className="min-w-0 flex-1">
            <AnimatePresence mode="wait">
              {done && !secret ? (
                <motion.div key="done" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={liquid}>
                  <div className="flex items-center gap-3">
                    <span className="grid h-12 w-12 place-items-center rounded-full bg-signal">
                      <CheckIcon size={24} />
                    </span>
                    <span className="font-display text-[32px] font-normal">Delivery proven</span>
                  </div>
                  <p className="mt-3 text-[14px] text-ash">
                    {done.impact ? "All confirmations in — the contract paid the final 30% and minted Proof-of-Impact tokens to the donors." : `${done.required - done.deliveries} more card(s) to go before the final 30% unlocks.`}
                  </p>
                </motion.div>
              ) : (
                <motion.div key="check" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={liquid}>
                  <div className="text-[13px] text-graphite">Payout #{payout.id} · root</div>
                  <HashText value={payout.beneficiaryRoot} n={8} />
                  {check ? (
                    <div className={`mt-4 rounded-[var(--radius-tile)] border p-4 text-[14px] ${check.ok ? "border-signal-deep bg-signal-mist" : "hatch border-obsidian bg-white"}`}>
                      {check.msg}
                      {check.commitment && (
                        <div className="mt-1 text-[13px] text-graphite">
                          commitment <HashText value={check.commitment} /> · proof {check.proof.length} hashes
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
      setErr(String(e?.message ?? e).includes("Permission") ? "Camera permission denied." : "No camera available — paste the secret instead.");
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
