import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { useApp } from "../lib/store";
import { CATEGORIES, CAT, toWei, fromWei } from "../lib/chain";
import { fadeUp, liquid, stagger } from "../lib/motion";
import { Section, Card, Button, Field, Input, Segmented, StatusBadge, Rupees, RoleGate } from "../components/ui/kit";
import { IconOrb } from "../components/ui/primitives";
import { CategoryIcon, BridgeIcon, VaultIcon, CheckIcon, HourglassIcon, RefundIcon, ShieldCheckIcon, QrIcon } from "../components/icons";

export default function Donate() {
  return (
    <motion.div variants={stagger(0.07)} initial="hidden" animate="show">
      <motion.section variants={fadeUp} className="pt-10 pb-8">
        <span className="text-[12px] text-graphite">Root 01 · Inbound donation</span>
        <h1 className="font-display text-[64px] leading-[0.95] font-light tracking-tight">Donate with proof</h1>
        <p className="mt-4 max-w-[560px] text-[15px] text-ash">Your money becomes a tagged lot held by the contract. It moves only against a vendor-signed invoice and finishes only when beneficiaries prove delivery.</p>
      </motion.section>
      <motion.div variants={fadeUp}>
        <RoleGate kinds={["Donor"]}>
          <DonateForm />
        </RoleGate>
      </motion.div>
    </motion.div>
  );
}

function DonateForm() {
  const { state, c, chain, address, tx, chainNow, config, toast, relayer } = useApp();
  const navigate = useNavigate();
  const [ngoId, setNgoId] = useState(() => state.ngos.find((n) => !n.frozen)?.id ?? 0);
  const [category, setCategory] = useState("Water");
  const [amount, setAmount] = useState("25000");
  const [days, setDays] = useState("30");
  const [source, setSource] = useState("A");
  const [balances, setBalances] = useState({ A: null, B: null });
  const [busy, setBusy] = useState(false);
  const [relaying, setRelaying] = useState(null); // { since: lotCount, nonce: bridge nonce }

  const refresh = useCallback(async () => {
    if (!c || !address) return;
    const [a, b] = await Promise.all([c.dinr.balanceOf(address).catch(() => 0n), c.dinrB.balanceOf(address).catch(() => 0n)]);
    setBalances({ A: fromWei(a), B: fromWei(b) });
  }, [c, address]);
  useEffect(() => {
    refresh();
  }, [refresh, state.updatedAt]);

  // bridged donation: wait for the relayer to land it as a lot on chain A
  useEffect(() => {
    if (!relaying) return;
    const lot = state.lots.find((l) => l.id >= relaying.since && l.donor.toLowerCase() === address.toLowerCase() && l.sourceChain === config.chainB.chainId);
    if (lot) {
      setRelaying(null);
      toast({ title: "Bridge delivered", body: `Lot #${lot.id} is now in escrow on chain A`, tone: "ok" });
      navigate(`/passport/${lot.id}`);
    }
  }, [state.lots, relaying, address, config, navigate, toast]);

  // the relayer could not deliver it (e.g. the NGO froze in between): stop waiting, say why
  useEffect(() => {
    if (!relaying || relayer?.status !== "failed" || String(relayer.nonce) !== relaying.nonce) return;
    setRelaying(null);
    toast({ title: "Bridge delivery failed", body: `${relayer.error}. The money stays locked in the bridge on chain B and is retried when the relayer restarts.`, tone: "error", ms: 10000 });
  }, [relayer, relaying, toast]);

  const ngo = state.ngos[ngoId];
  const amt = Number(amount);
  const nDays = Math.max(1, Math.floor(Number(days) || 0));
  const balance = balances[source];
  const valid = ngo && !ngo.frozen && amt > 0 && balance !== null && amt <= balance;

  async function submit() {
    setBusy(true);
    try {
      const wei = toWei(amt);
      const deadline = BigInt(chainNow() + nDays * 86400);
      const cat = CAT[category];
      if (source === "A") {
        const vaultAddr = chain.A.GlassVault.address;
        if ((await c.dinr.allowance(address, vaultAddr)) < wei) await tx("Approve dINR for the vault", () => c.dinr.approve(vaultAddr, wei));
        const rc = await tx(`Donate ₹${amt.toLocaleString("en-IN")} to ${ngo.name}`, () => c.vault.donate(ngoId, cat, wei, deadline));
        const ev = rc.logs.map((l) => c.vault.interface.parseLog(l)).find((p) => p?.name === "Donated");
        if (ev) navigate(`/passport/${Number(ev.args.lotId)}`);
      } else {
        const gw = chain.B.BridgeGateway.address;
        if ((await c.dinrB.allowance(address, gw)) < wei) await tx("Approve dINR on chain B", () => c.dinrB.approve(gw, wei));
        const since = state.lots.length;
        const rc = await tx(`Send ₹${amt.toLocaleString("en-IN")} over the bridge`, () => c.gatewayB.sendDonation(ngoId, cat, wei, deadline, config.chainA.chainId));
        const sent = rc.logs.map((l) => c.gatewayB.interface.parseLog(l)).find((p) => p?.name === "DonationSent");
        setRelaying({ since, nonce: sent ? String(sent.args.nonce) : null });
      }
      refresh();
    } catch {
      /* toast already shown */
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-10 lg:grid-cols-[1fr_400px]">
      <div>
        <Section eyebrow="Step 1" title="Choose an NGO">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {state.ngos.map((n) => {
              const on = n.id === ngoId;
              return (
                <motion.button
                  key={n.id}
                  type="button"
                  disabled={n.frozen}
                  onClick={() => setNgoId(n.id)}
                  whileHover={n.frozen ? undefined : { y: -2 }}
                  transition={liquid}
                  className={`relative rounded-[var(--radius-card)] border p-6 text-left disabled:cursor-not-allowed ${n.frozen ? "hatch border-hairline bg-paper opacity-60" : on ? "border-obsidian bg-white" : "border-hairline bg-paper"}`}
                >
                  {on && <motion.span layoutId="ngo-pick" transition={liquid} className="absolute top-5 right-5 grid h-7 w-7 place-items-center rounded-full bg-signal"><CheckIcon size={14} /></motion.span>}
                  <div className="text-[12px] text-graphite">NGO #{n.id}</div>
                  <div className="font-display text-[22px] font-medium">{n.name}</div>
                  <div className="mt-4 flex items-end gap-6">
                    <div>
                      <div className="text-[12px] text-graphite">Trust</div>
                      <div className="font-display text-[36px] leading-none font-light tabular">{n.trust}</div>
                    </div>
                    <div className="pb-1 text-[13px] text-ash">
                      {n.payoutsCompleted}/{n.payoutsTotal} payouts proven · {n.flagCount} flags
                    </div>
                  </div>
                  {n.frozen && <div className="mt-3"><StatusBadge status="Frozen" label="Frozen · not accepting donations" /></div>}
                </motion.button>
              );
            })}
          </div>
        </Section>

        <Section eyebrow="Step 2" title="Purpose and amount">
          <div className="flex flex-col gap-6">
            <Segmented id="cat" value={category} onChange={setCategory} options={CATEGORIES.map((cname) => ({ value: cname, label: cname, icon: <CategoryIcon category={cname} size={16} /> }))} />
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field label="Amount (₹)" hint={balance !== null ? `Balance on chain ${source}: ₹${balance.toLocaleString("en-IN")}` : "Loading balance…"}>
                <Input type="number" min="1" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </Field>
              <Field label="Proof deadline (days)" hint="If no proof by then, you can reclaim what's unspent.">
                <Input type="number" min="1" value={days} onChange={(e) => setDays(e.target.value)} />
              </Field>
            </div>
            <div className="flex flex-wrap gap-2">
              {[5000, 25000, 50000, 100000].map((v) => (
                <button key={v} type="button" onClick={() => setAmount(String(v))} className="h-9 rounded-full border border-hairline bg-white px-4 text-[13px] text-ash hover:border-obsidian">
                  ₹{v.toLocaleString("en-IN")}
                </button>
              ))}
            </div>
          </div>
        </Section>

        <Section eyebrow="Step 3" title="Send from">
          <Segmented
            id="src"
            value={source}
            onChange={setSource}
            options={[
              { value: "A", label: "Chain A · direct", icon: <VaultIcon size={16} /> },
              { value: "B", label: "Chain B · via bridge", icon: <BridgeIcon size={16} /> },
            ]}
          />
          <div className="mt-4 grid grid-cols-2 gap-4 text-[13px]">
            <BalanceTile label={`Chain A · ${config.chainA.chainId}`} value={balances.A} active={source === "A"} />
            <BalanceTile label={`Chain B · ${config.chainB.chainId}`} value={balances.B} active={source === "B"} />
          </div>
          {source === "B" && <p className="mt-3 text-[13px] text-ash">Your dINR is locked on chain B. The relayer delivers it into a vault lot on chain A that keeps you as the donor and records the source chain.</p>}
        </Section>
      </div>

      <div className="lg:sticky lg:top-[112px] lg:self-start">
        <Card className="p-6">
          <div className="text-[12px] text-graphite">Escrow rules — enforced by the contract</div>
          <div className="mt-1 font-display text-[40px] leading-none font-light">
            <Rupees value={amt || 0} />
          </div>
          <div className="mt-1 text-[14px] text-ash">
            for <span className="text-obsidian">{category}</span> at <span className="text-obsidian">{ngo?.name}</span>
          </div>
          <ul className="mt-6 space-y-3 border-t border-hairline pt-5 text-[14px]">
            <Rule icon={<CategoryIcon category={category} size={16} />}>Can only be spent on {category.toLowerCase()} vendors.</Rule>
            <Rule icon={<ShieldCheckIcon size={16} />}>Each payout needs an invoice signed by a staked vendor; a reused or forged one is flagged.</Rule>
            <Rule icon={<HourglassIcon size={16} />}>Every payout waits in a public challenge window; you vote if it's disputed.</Rule>
            <Rule icon={<QrIcon size={16} />}>70% on the invoice, the last 30% only after beneficiaries prove delivery.</Rule>
            <Rule icon={<RefundIcon size={16} />}>No proof in {nDays} day{nDays === 1 ? "" : "s"}, or the NGO is frozen → you reclaim what's unspent.</Rule>
          </ul>
          <Button variant="signal" className="mt-6 w-full" disabled={!valid || busy || !!relaying} onClick={submit}>
            {busy ? "Confirming…" : source === "A" ? "Donate" : "Send over bridge"}
          </Button>
          {amt > (balance ?? Infinity) && <div className="mt-2 text-[12px] text-graphite">Not enough dINR on chain {source}.</div>}
          <AnimatePresence>
            {relaying && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                <div className="mt-4 flex items-center gap-3 rounded-[var(--radius-tile)] border border-signal-deep bg-signal-mist p-4 text-[13px]">
                  <motion.span animate={{ x: [0, 6, 0] }} transition={{ repeat: Infinity, duration: 1.2 }}>
                    <BridgeIcon size={18} />
                  </motion.span>
                  Relaying from chain B to chain A…
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </Card>
      </div>
    </div>
  );
}

function Rule({ icon, children }) {
  return (
    <li className="flex gap-3">
      <IconOrb size={28}>{icon}</IconOrb>
      <span className="pt-1 text-ash">{children}</span>
    </li>
  );
}

function BalanceTile({ label, value, active }) {
  return (
    <div className={`rounded-[var(--radius-tile)] border p-4 ${active ? "border-obsidian bg-white" : "border-hairline bg-paper"}`}>
      <div className="text-graphite">{label}</div>
      <div className="font-display text-[24px] font-light">{value === null ? "…" : <Rupees value={value} />}</div>
    </div>
  );
}
