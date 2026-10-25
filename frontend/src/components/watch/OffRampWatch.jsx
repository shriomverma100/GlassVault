import { useApp, useRerenderAt } from "../../lib/store";
import { inr } from "../../lib/format";
import { Button, Card, Countdown, Empty, Rupees, Section } from "../ui/kit";
import { sameAddr } from "../ops/shared";

/// Money that left escrow through a fiat payment agent must be proven paid out in rupees. Anyone can
/// flag a payout whose settlement is overdue — the agent's stake goes to whoever flags it.
export default function OffRampWatch() {
  const { state, c, tx, chainNow, user } = useApp("state", "c", "tx", "chainNow", "user");
  const offRamp = state.payouts.filter((p) => p.offRamp && p.status === "Released" && !p.fiat && !p.unexplained);
  useRerenderAt(offRamp.map((p) => p.fiatDeadline));
  const now = chainNow();
  const overdue = offRamp.filter((p) => p.fiatDeadline && now > p.fiatDeadline);
  const waiting = offRamp.filter((p) => !(p.fiatDeadline && now > p.fiatDeadline));
  const flagged = state.payouts.filter((p) => p.unexplained);
  const agent = (p) => state.vendors.find((v) => sameAddr(v.address, p.vendor));

  return (
    <Section eyebrow="Fiat off-ramps" title="Was the money really paid out in rupees?">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_360px]">
        <div className="flex flex-col gap-3">
          {overdue.length === 0 && waiting.length === 0 && flagged.length === 0 && <Empty>No payouts have gone through a fiat payment agent yet.</Empty>}
          {overdue.map((p) => (
            <Card key={p.id} className="hatch flex flex-wrap items-center justify-between gap-4 border-obsidian bg-obsidian p-5 text-white">
              <div>
                <div className="text-[16px] font-medium">
                  Payout #{p.id} · {inr(Math.round(p.amount * 0.7))} released, never proven paid in rupees
                </div>
                <div className="text-[14px] text-white/80">
                  {state.ngos[p.ngoId]?.name} → agent stake {inr(agent(p)?.stake ?? 0)} goes to whoever flags it
                </div>
              </div>
              <Button variant="signal" disabled={!user} onClick={() => tx(`Flag unexplained transfer · payout #${p.id}`, () => c.vault.flagUnsettled(p.id)).catch(() => {})}>
                {user ? "Flag unexplained transfer" : "Sign in to flag"}
              </Button>
            </Card>
          ))}
          {waiting.map((p) => (
            <Card key={p.id} className="flex flex-wrap items-center justify-between gap-4 p-5">
              <div className="text-[15px]">
                Payout #{p.id} · <Rupees value={p.amount} /> · {state.ngos[p.ngoId]?.name}
              </div>
              <span className="text-[14px] text-ash">
                agent must settle within <Countdown until={p.fiatDeadline} done="now" />
              </span>
            </Card>
          ))}
          {flagged.map((p) => (
            <Card key={p.id} className="flex flex-wrap items-center justify-between gap-4 p-5">
              <div className="text-[15px]">Payout #{p.id} flagged as an unexplained transfer</div>
              <span className="text-[14px] text-ash">reporter earned {inr(p.unexplained.reward ?? 0)}</span>
            </Card>
          ))}
        </div>
        <EscrowLedger ledger={state.stats.ledger} />
      </div>
    </Section>
  );
}

/// The contract's token balance must equal everything it owes: unspent lots, unpaid payout parts,
/// bonds, stakes and challenge bonds. A gap means money moved that the ledger can't explain.
function EscrowLedger({ ledger }) {
  if (!ledger) return null;
  const clean = Math.abs(ledger.gap ?? 0) < 1;
  return (
    <Card className={`p-6 ${clean ? "" : "hatch border-obsidian bg-obsidian text-white"}`}>
      <div className={`text-[13px] font-medium ${clean ? "text-ash" : "text-white/80"}`}>Escrow ledger · recomputed from chain events</div>
      <dl className="mt-4 grid grid-cols-2 gap-y-2 text-[14px]">
        <dt className={clean ? "text-ash" : "text-white/80"}>Held by the contract</dt>
        <dd className="text-right tabular">{inr(ledger.vaultBalance)}</dd>
        <dt className={clean ? "text-ash" : "text-white/80"}>Accounted for</dt>
        <dd className="text-right tabular">{inr(ledger.accounted)}</dd>
      </dl>
      <div className={`mt-4 border-t pt-4 text-[15px] font-medium ${clean ? "border-hairline" : "border-white/30"}`}>
        {clean ? "Every rupee in escrow is accounted for." : `${inr(Math.abs(ledger.gap))} unexplained`}
      </div>
    </Card>
  );
}
