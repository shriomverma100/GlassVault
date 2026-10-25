import { useCallback, useEffect, useState } from "react";
import { ethers } from "ethers";
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
        <span className="text-[13px] text-graphite">Root 01 · Inbound donation</span>
        <h1 className="font-display text-[64px] leading-[0.95] font-normal tracking-tight">Donate with proof</h1>
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
  const { state, c, chain, address, tx, chainNow, config, toast, relayer } = useApp("state", "c", "chain", "address", "tx", "chainNow", "config", "toast", "relayer");
  const navigate = useNavigate();
  const [ngoId, setNgoId] = useState(() => state.ngos.find((n) => !n.frozen)?.id ?? 0);
  const [category, setCategory] = useState("Water");
  const [amount, setAmount] = useState("25000");
  const [days, setDays] = useState("30");
  const [source, setSource] = useState("A");
  const [balances, setBalances] = useState({ A: null, B: null });
  const [busy, setBusy] = useState(false);
  const [relaying, setRelaying] = useState(null); // { since: lotCount, nonce: bridge nonce }
  // multi-hop path: pay ETH on chain B → swapped to dINR at the DEX → bridged → lot on chain A
  const [asset, setAsset] = useState("dINR");
  const [ethAmount, setEthAmount] = useState("0.5");
  const [ethBalance, setEthBalance] = useState(null);
  const [quote, setQuote] = useState(null); // ₹ the DEX gives for ethAmount

  const refresh = useCallback(async () => {
    if (!c || !address) return;
    const [a, b] = await Promise.all([c.dinr.balanceOf(address).catch(() => 0n), c.dinrB.balanceOf(address).catch(() => 0n)]);
    setBalances({ A: fromWei(a), B: fromWei(b) });
    chain?.providerB.getBalance(address).then((w) => setEthBalance(Number(ethers.formatEther(w)))).catch(() => {});
  }, [c, chain, address]);
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

  const payEth = source === "B" && asset === "ETH" && !!c?.dexB;
  const eth = Number(ethAmount);

  // live DEX quote for the ETH path (what the lot will hold after the swap)
  useEffect(() => {
    if (!payEth || !(eth > 0)) return setQuote(null);
    let live = true;
    const id = setTimeout(() => {
      c.dexB
        .quote(ethers.parseEther(String(eth)))
        .then((out) => live && setQuote(fromWei(out)))
        .catch(() => live && setQuote(null));
    }, 150);
    return () => {
      live = false;
      clearTimeout(id);
    };
  }, [payEth, eth, c]);

  const ngo = state.ngos[ngoId];
  // dead-man switch target: refund the donor (default) or move unspent funds to another NGO
  const fallbackChoices = state.ngos.filter((n) => !n.frozen && n.id !== ngoId);
  const [fallbackMode, setFallbackMode] = useState("refund");
  const [fallbackPick, setFallbackPick] = useState(null);
  const fallbackId = fallbackMode === "ngo" ? (fallbackChoices.find((n) => n.id === fallbackPick) ?? fallbackChoices[0])?.id ?? null : null;
  const amt = payEth ? (quote ?? 0) : Number(amount);
  const nDays = Math.max(1, Math.floor(Number(days) || 0));
  const balance = balances[source];
  const valid = payEth
    ? ngo && !ngo.frozen && eth > 0 && quote > 0 && ethBalance !== null && eth <= ethBalance
    : ngo && !ngo.frozen && amt > 0 && balance !== null && amt <= balance;

  async function submit() {
    setBusy(true);
    try {
      const wei = toWei(amt);
      const deadline = BigInt(chainNow() + nDays * 86400);
      const cat = CAT[category];
      if (source === "A") {
        const vaultAddr = chain.A.GlassVault.address;
        if ((await c.dinr.allowance(address, vaultAddr)) < wei) await tx("Approve dINR for the vault", () => c.dinr.approve(vaultAddr, wei));
        const rc = await tx(`Donate ₹${amt.toLocaleString("en-IN")} to ${ngo.name}`, () =>
          fallbackId === null ? c.vault.donate(ngoId, cat, wei, deadline) : c.vault.donateWithFallback(ngoId, cat, wei, deadline, fallbackId),
        );
        const ev = rc.logs.map((l) => c.vault.interface.parseLog(l)).find((p) => p?.name === "Donated");
        if (ev) navigate(`/passport/${Number(ev.args.lotId)}`);
      } else if (payEth) {
        // one transaction on chain B: swap at the DEX (≤1% slippage) and lock the dINR in the bridge
        const value = ethers.parseEther(String(eth));
        const minOut = ((await c.dexB.quote(value)) * 99n) / 100n;
        const since = state.lots.length;
        const rc = await tx(`Swap ${eth} ETH to rupees and bridge it`, () =>
          c.gatewayB.sendDonationWithSwap(c.dexB.target, ngoId, cat, deadline, config.chainA.chainId, minOut, { value }),
        );
        const sent = rc.logs.map((l) => c.gatewayB.interface.parseLog(l)).find((p) => p?.name === "DonationSent");
        setRelaying({ since, nonce: sent ? String(sent.args.nonce) : null });
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
                  <div className="text-[13px] text-graphite">NGO #{n.id}</div>
                  <div className="font-display text-[22px] font-medium">{n.name}</div>
                  <div className="mt-4 flex items-end gap-6">
                    <div>
                      <div className="text-[13px] text-graphite">Trust</div>
                      <div className="font-display text-[36px] leading-none font-normal tabular">{n.trust}</div>
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
              {payEth ? (
                <Field
                  label="Amount (ETH)"
                  hint={`${quote ? `Swaps to about ₹${Math.floor(quote).toLocaleString("en-IN")}` : "Getting a quote…"} · balance ${ethBalance === null ? "…" : ethBalance.toFixed(3)} ETH on chain B`}
                >
                  <Input type="number" min="0" step="0.01" value={ethAmount} onChange={(e) => setEthAmount(e.target.value)} />
                </Field>
              ) : (
                <Field label="Amount (₹)" hint={balance !== null ? `Balance on chain ${source}: ₹${balance.toLocaleString("en-IN")}` : "Loading balance…"}>
                  <Input type="number" min="1" value={amount} onChange={(e) => setAmount(e.target.value)} />
                </Field>
              )}
              <Field label="Proof deadline (days)" hint="If no proof by then, you can reclaim what's unspent.">
                <Input type="number" min="1" value={days} onChange={(e) => setDays(e.target.value)} />
              </Field>
            </div>
            <div className={`flex flex-wrap gap-2 ${payEth ? "hidden" : ""}`}>
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
          {source === "B" && c?.dexB && (
            <div className="mt-4">
              <Segmented
                id="asset"
                value={asset}
                onChange={setAsset}
                options={[
                  { value: "dINR", label: "Pay in rupees (dINR)" },
                  { value: "ETH", label: "Pay in ETH · swapped" },
                ]}
              />
            </div>
          )}
          {source === "B" && (
            <p className="mt-3 text-[14px] text-ash">
              {payEth
                ? "Your ETH is swapped to rupees at the exchange and locked in the bridge in one transaction. The relayer turns it into a lot on chain A that still remembers you, the ETH you paid and the swap — every hop stays traceable."
                : "Your dINR is locked on chain B. The relayer delivers it into a vault lot on chain A that keeps you as the donor and records the source chain."}
            </p>
          )}
        </Section>

        {source === "A" && (
          <Section eyebrow="Step 4" title="If this NGO is frozen or misses the deadline">
            <Segmented
              id="fallback"
              value={fallbackMode}
              onChange={setFallbackMode}
              options={[
                { value: "refund", label: "Refund me" },
                { value: "ngo", label: "Send it to another NGO" },
              ]}
            />
            {fallbackMode === "ngo" && (
              <div className="mt-4">
                {fallbackChoices.length ? (
                  <Segmented
                    id="fallback-ngo"
                    value={fallbackId}
                    onChange={setFallbackPick}
                    options={fallbackChoices.map((n) => ({ value: n.id, label: `${n.name} · trust ${n.trust}` }))}
                  />
                ) : (
                  <p className="text-[14px] text-ash">No other active NGO to pick — your unspent funds will be refunded.</p>
                )}
              </div>
            )}
            <p className="mt-3 text-[14px] text-ash">
              Nobody can keep your money: unspent funds either come back to you or move to the NGO you pick — anyone can trigger it once the deadline passes. The
              purpose ({category.toLowerCase()}) stays the same.
            </p>
          </Section>
        )}
      </div>

      <div className="lg:sticky lg:top-[112px] lg:self-start">
        <Card className="p-6">
          <div className="text-[13px] text-graphite">Escrow rules — enforced by the contract</div>
          <div className="mt-1 font-display text-[40px] leading-none font-normal">
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
            <Rule icon={<RefundIcon size={16} />}>
              No proof in {nDays} day{nDays === 1 ? "" : "s"}, or the NGO is frozen →{" "}
              {fallbackId === null ? "you reclaim what's unspent." : `what's unspent moves to ${state.ngos[fallbackId]?.name}.`}
            </Rule>
          </ul>
          <Button variant="signal" className="mt-6 w-full" disabled={!valid || busy || !!relaying} onClick={submit}>
            {busy ? "Confirming…" : source === "A" ? "Donate" : payEth ? "Swap, bridge and donate" : "Send over bridge"}
          </Button>
          {!payEth && amt > (balance ?? Infinity) && <div className="mt-2 text-[13px] text-graphite">Not enough dINR on chain {source}.</div>}
          {payEth && eth > (ethBalance ?? Infinity) && <div className="mt-2 text-[13px] text-graphite">Not enough ETH on chain B.</div>}
          {payEth && quote > 0 && <div className="mt-2 text-[13px] text-ash">You pay {eth} ETH · the lot holds the swapped rupees (min. 99% of the quote).</div>}
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
      <div className="font-display text-[24px] font-normal">{value === null ? "…" : <Rupees value={value} />}</div>
    </div>
  );
}
