import { Link } from "react-router-dom";
import { useApp, useRerenderAt, payoutBoundaries } from "../lib/store";
import { inr } from "../lib/format";
import { sameAddr, useApiList } from "./ops/shared";

/// "What should I do now?" — the open tasks for the signed-in account, derived from chain state.
/// Shown at the top of the account's own workspace.
export default function NextActions() {
  const { state, user, chainNow } = useApp("state", "user", "chainNow");
  useRerenderAt(state ? payoutBoundaries(state.payouts) : []);
  // signed invoices waiting for this NGO live off-chain (the vendor's signature, not yet submitted)
  const myNgo = user?.kind === "NGO" ? state?.ngos.find((n) => sameAddr(n.admin, user.address)) : null;
  const [invoices] = useApiList(myNgo ? `/api/invoices?ngoId=${myNgo.id}` : null);
  if (!state || !user) return null;
  const tasks = TASKS[user.kind]?.(state, user.address, chainNow(), { invoices }) ?? [];

  return (
    <section data-tour="next-actions" aria-label="Next actions" className="mt-8 rounded-[var(--radius-tile)] border border-hairline bg-white px-6 py-4">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <span className="text-[13px] font-medium text-ash">{tasks.length ? "Next for you" : "You're all caught up"}</span>
        {tasks.slice(0, 4).map((t) => (
          <Link key={t.text} to={t.to} className={`rounded-full border px-4 py-1.5 text-[14px] transition-colors ${t.urgent ? "border-obsidian bg-obsidian text-white hover:bg-charcoal" : "border-hairline bg-paper hover:border-ash/40"}`}>
            {t.text}
          </Link>
        ))}
        {!tasks.length && <span className="text-[14px] text-ash">{IDLE[user.kind]}</span>}
      </div>
    </section>
  );
}

const IDLE = {
  Donor: "Your donations are in escrow or delivered. We'll show disputes and refunds here.",
  NGO: "No invoices waiting and nothing to release.",
  Vendor: "No payouts pending. Issue an invoice when you deliver goods.",
  Field: "No deliveries waiting for confirmation.",
  Watcher: "No payouts are open to challenge right now.",
};

const redirectable = (state, l) => l.fallbackNgoId != null && !state.ngos[l.fallbackNgoId]?.frozen;
const fundedBy = (state, p, address) => p.shares.some((s) => sameAddr(state.lots[s.lotId]?.donor, address));

const TASKS = {
  Donor(state, me, now) {
    const lots = state.lots.filter((l) => sameAddr(l.donor, me));
    if (!lots.length) return [{ text: "Make your first donation", to: "/donate" }];
    const votes = state.payouts.filter((p) => p.status === "Challenged" && p.challenge && now < p.challenge.voteEnd && fundedBy(state, p, me));
    const expired = lots.filter((l) => l.remaining > 0 && l.redirectedTo == null && (state.ngos[l.ngoId]?.frozen || now > l.deadline));
    const redirects = expired.filter((l) => redirectable(state, l));
    const refunds = expired.filter((l) => !redirectable(state, l));
    return [
      ...votes.map((p) => ({ text: `Vote on disputed payout #${p.id}`, to: "/watchtower", urgent: true })),
      ...redirects.map((l) => ({ text: `Move unspent ${inr(l.remaining)} from donation #${l.id} to ${state.ngos[l.fallbackNgoId].name}`, to: `/passport/${l.id}`, urgent: true })),
      ...refunds.map((l) => ({ text: `Reclaim ${inr(l.remaining)} from donation #${l.id}`, to: `/passport/${l.id}`, urgent: true })),
      { text: "Donate again", to: "/donate" },
    ];
  },
  NGO(state, me, now, { invoices }) {
    const ngo = state.ngos.find((n) => sameAddr(n.admin, me));
    if (!ngo) return [{ text: "Register your NGO on-chain (₹10,000 bond)", to: "/ngo", urgent: true }];
    if (ngo.frozen) return [{ text: "Frozen by the contract — donors are reclaiming unspent funds", to: "/ngo", urgent: true }];
    const mine = state.payouts.filter((p) => p.ngoId === ngo.id);
    const releasable = mine.filter((p) => p.status === "Pending" && now >= p.releaseAt);
    const awaiting = mine.filter((p) => (p.status === "Pending" || p.status === "Released") && p.deliveries < p.deliveriesRequired);
    const disputed = mine.filter((p) => p.status === "Challenged");
    const inbox = invoices.filter((i) => i.status === "signed");
    return [
      ...inbox.map((i) => ({ text: `Pay invoice ${i.invoiceNo} (${inr(i.amount)}) — request payout`, to: "/ngo", urgent: true })),
      ...disputed.map((p) => ({ text: `Payout #${p.id} is disputed — donors are voting`, to: "/watchtower", urgent: true })),
      ...releasable.map((p) => ({ text: `Release payout #${p.id} to the vendor`, to: "/ngo" })),
      ...awaiting.map((p) => ({ text: `Payout #${p.id}: ${p.deliveriesRequired - p.deliveries} deliveries to confirm`, to: "/field" })),
    ];
  },
  Vendor(state, me, now) {
    const v = state.vendors.find((x) => sameAddr(x.address, me));
    if (!v?.registered) return [{ text: v ? "Your stake was slashed — this wallet is banned" : "Register and stake ₹5,000 to sign invoices", to: "/vendor", urgent: true }];
    const mine = state.payouts.filter((p) => sameAddr(p.vendor, me));
    // fiat agents must prove each released payout was paid out in rupees, or lose their stake
    const toSettle = v.offRamp ? mine.filter((p) => p.status === "Released" && !p.fiat) : [];
    const pending = mine.filter((p) => p.status !== "Completed" && p.status !== "Cancelled" && !toSettle.includes(p));
    return [
      ...toSettle.map((p) => ({ text: `Settle payout #${p.id} in rupees${now > p.fiatDeadline ? " — overdue" : ""}`, to: "/vendor", urgent: true })),
      { text: "Issue an invoice", to: "/vendor" },
      ...pending.map((p) => ({ text: `Payout #${p.id}: ${p.status.toLowerCase()}`, to: "/vendor" })),
    ];
  },
  Field(state, me) {
    const partner = (state.fieldPartners ?? []).find((p) => sameAddr(p.address, me));
    if (!partner?.registered) {
      return [{ text: partner ? "This field-partner wallet was slashed" : "Register as a field partner (₹2,000 stake)", to: "/field", urgent: true }];
    }
    const scans = state.payouts
      .filter((p) => (p.status === "Pending" || p.status === "Released") && p.deliveries < p.deliveriesRequired && !state.ngos[p.ngoId]?.frozen)
      .map((p) => ({ text: `Payout #${p.id}: ${p.deliveriesRequired - p.deliveries} cards to scan`, to: "/field" }));
    return [...scans, { text: "Issue cards for an NGO", to: "/field" }];
  },
  Watcher(state, me, now) {
    const open = state.payouts.filter((p) => p.status === "Pending" && now < p.releaseAt && !state.ngos[p.ngoId]?.frozen);
    const unsettled = state.payouts.filter((p) => p.offRamp && p.status === "Released" && !p.fiat && p.fiatDeadline && now > p.fiatDeadline);
    const unproven = state.payouts.filter((p) => p.status === "Released" && p.impactDeadline && !p.impactExpired && p.deliveries < p.deliveriesRequired && now > p.impactDeadline);
    const stuckLots = state.lots.filter((l) => l.remaining > 0 && l.redirectedTo == null && redirectable(state, l) && (state.ngos[l.ngoId]?.frozen || now > l.deadline));
    return [
      ...unsettled.map((p) => ({ text: `Payout #${p.id}: never paid out in rupees — flag it`, to: "/watchtower", urgent: true })),
      ...unproven.map((p) => ({ text: `Return unproven 30% of payout #${p.id}`, to: "/watchtower", urgent: true })),
      ...stuckLots.map((l) => ({ text: `Redirect expired donation #${l.id}`, to: "/watchtower", urgent: true })),
      ...open.map((p) => ({ text: `Review payout #${p.id} before its window closes`, to: "/watchtower" })),
    ];
  },
};
