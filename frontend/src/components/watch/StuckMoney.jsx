import { useApp, useRerenderAt } from "../../lib/store";
import { inr } from "../../lib/format";
import { Button, Card, Countdown, Empty, Section } from "../ui/kit";

/// Money must never get stuck: an unproven final 30% goes back to donors after the impact deadline,
/// and an expired donation with a fallback NGO moves there. Any signed-in person can trigger both —
/// the contract checks the rules, nobody needs permission.
export default function StuckMoney() {
  const { state, c, tx, chainNow, user } = useApp("state", "c", "tx", "chainNow", "user");
  const awaiting = state.payouts.filter((p) => p.status === "Released" && p.impactDeadline && !p.impactExpired && p.deliveries < p.deliveriesRequired);
  const redirectable = state.lots.filter((l) => l.fallbackNgoId != null && l.redirectedTo == null && l.remaining > 0);
  useRerenderAt([...awaiting.map((p) => p.impactDeadline), ...redirectable.map((l) => l.deadline)]);
  const now = chainNow();
  const overdue = awaiting.filter((p) => now > p.impactDeadline);
  const waiting = awaiting.filter((p) => now <= p.impactDeadline);
  const expiredLots = redirectable.filter((l) => (state.ngos[l.ngoId]?.frozen || now > l.deadline) && !state.ngos[l.fallbackNgoId]?.frozen);
  const run = (label, fn) => tx(label, fn).catch(() => {});
  const unpaid = (p) => p.amount - p.paid;

  return (
    <Section eyebrow="No money gets stuck" title="Deadlines anyone can enforce">
      <p className="-mt-2 mb-5 max-w-[760px] text-[14px] text-ash">
        If delivery is never proven, the unpaid 30% goes back to the donors. If an NGO is frozen or misses its deadline, a donation with a fallback moves to the NGO the
        donor chose. Anyone signed in can press these buttons — the contract checks the deadline, so nobody needs permission.
      </p>
      <div className="flex flex-col gap-3">
        {overdue.length + waiting.length + expiredLots.length === 0 && <Empty>Nothing is past its deadline.</Empty>}
        {overdue.map((p) => (
          <Card key={`p${p.id}`} className="flex flex-wrap items-center justify-between gap-4 p-5">
            <div className="text-[15px]">
              Payout #{p.id} · {state.ngos[p.ngoId]?.name} · delivery never proven ({p.deliveries}/{p.deliveriesRequired}) — {inr(unpaid(p))} still held
            </div>
            <Button variant="signal" disabled={!user} onClick={() => run(`Return unproven 30% of payout #${p.id}`, () => c.vault.expireImpact(p.id))}>
              {user ? "Return unproven 30%" : "Sign in to return it"}
            </Button>
          </Card>
        ))}
        {waiting.map((p) => (
          <Card key={`w${p.id}`} className="flex flex-wrap items-center justify-between gap-4 p-5">
            <div className="text-[15px]">
              Payout #{p.id} · {p.deliveries}/{p.deliveriesRequired} deliveries proven
            </div>
            <span className="text-[14px] text-ash">
              impact deadline in <Countdown until={p.impactDeadline} done="now" />
            </span>
          </Card>
        ))}
        {expiredLots.map((l) => (
          <Card key={`l${l.id}`} className="flex flex-wrap items-center justify-between gap-4 p-5">
            <div className="text-[15px]">
              Donation #{l.id} · {state.ngos[l.ngoId]?.name} {state.ngos[l.ngoId]?.frozen ? "is frozen" : "missed the deadline"} — {inr(l.remaining)} unspent
            </div>
            <Button variant="signal" disabled={!user} onClick={() => run(`Redirect donation #${l.id}`, () => c.vault.redirect(l.id))}>
              {user ? `Redirect to ${state.ngos[l.fallbackNgoId]?.name}` : "Sign in to redirect"}
            </Button>
          </Card>
        ))}
      </div>
    </Section>
  );
}
