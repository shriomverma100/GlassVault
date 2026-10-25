import { ROLE_META, short } from "./chain";

const fmt = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const rs = (wei) => `₹${fmt.format(Number(BigInt(wei ?? 0) / 10n ** 18n))}`;

// Registered accounts (address → display name), refreshed by the store. Read at call time, so labels
// pick up new sign-ups without re-creating labelers.
const directory = new Map();
export function setDirectory(list) {
  directory.clear();
  for (const a of list ?? []) directory.set(a.address.toLowerCase(), a.displayName);
}

/// address → account name (or the platform's own service roles), else a short address.
export function labeler(config) {
  const service = new Map();
  for (const [role, r] of Object.entries(config?.roles ?? {})) if (ROLE_META[role]) service.set(r.address.toLowerCase(), ROLE_META[role].label);
  return (addr) => {
    if (!addr) return "—";
    const k = String(addr).toLowerCase();
    return directory.get(k) ?? service.get(k) ?? short(String(addr), 4);
  };
}

/// Payouts that spent this lot, with this lot's share attached.
export function lotPayouts(state, lotId) {
  return (state?.payouts ?? [])
    .filter((p) => p.shares.some((s) => s.lotId === lotId))
    .map((p) => ({ ...p, share: p.shares.filter((s) => s.lotId === lotId).reduce((a, s) => a + s.amount, 0) }));
}

/// Money this lot really lost to a payout. A Cancelled payout returned only its unpaid part, so a
/// payout unwound after its 70% release still spent that 70% of the lot's share.
export const lotSpent = (p) => (p.status === "Cancelled" ? (p.share * p.paid) / p.amount : p.share);

/// The 4 roots for one donation. Returns statuses: done | pending | disputed | fraud | frozen | idle.
/// `disputed` = a challenge vote is still open (not fraud yet); `fraud` = a challenge was upheld.
export function lotSpine(lot, ngo, payouts) {
  const inbound = "done";
  const escrow = ngo?.frozen ? "frozen" : "done";
  const unwoundAfterPaying = (p) => p.status === "Cancelled" && p.paid > 0;
  let invoice = "idle";
  if (payouts.some((p) => p.status === "Released" || p.status === "Completed" || unwoundAfterPaying(p))) invoice = "done";
  else if (payouts.some((p) => p.status === "Pending")) invoice = "pending";
  if (invoice !== "done") {
    if (payouts.some((p) => p.status === "Cancelled" && p.challenge?.upheld)) invoice = "fraud";
    else if (payouts.some((p) => p.status === "Challenged")) invoice = "disputed";
  }
  let impact = "idle";
  if (payouts.some((p) => p.status === "Completed")) impact = "done";
  else if (payouts.some((p) => (p.status === "Released" || p.status === "Pending") && p.deliveries < p.deliveriesRequired)) impact = "pending";
  else if (payouts.some(unwoundAfterPaying)) impact = "frozen"; // vendor was paid, but delivery can no longer be proven
  return [inbound, escrow, invoice, impact];
}

const CAT = ["Water", "Medical", "Education"];
const REASON = ["duplicate invoice", "forged signature", "out-of-category spend", "over-budget charge", "amount mismatch", "unregistered vendor", "challenge upheld", "vendor signed the same invoice for two NGOs", "same bank transfer used to prove two payouts", "money released but never paid out in rupees"];

/// One human sentence per chain event, for the live ticker and timelines.
export function eventSentence(ev, label, state) {
  const a = ev.args ?? {};
  const ngo = (id) => state?.ngos?.[Number(id)]?.name ?? `NGO ${id}`;
  switch (ev.name) {
    case "NGORegistered":
      return `${a.name} registered and posted a ${rs(a.bond)} bond`;
    case "VendorRegistered":
      return `${label(a.vendor)} staked ${rs(a.stake)} as a ${CAT[Number(a.category)]} vendor`;
    case "Donated":
      return `${label(a.donor)} donated ${rs(a.amount)} for ${CAT[Number(a.category)]} to ${ngo(a.ngoId)}`;
    case "CrossChainDonation":
      return `Lot #${a.lotId} arrived from chain ${a.sourceChain} over the bridge`;
    case "PayoutRequested":
      return `${ngo(a.ngoId)} requested ${rs(a.amount)} for ${label(a.vendor)} · window open`;
    case "LotCharged":
      return `Lot #${a.lotId} charged ${rs(a.amount)} for payout #${a.payoutId}`;
    case "PayoutReleased":
      return `Payout #${a.payoutId}: ${rs(a.amount)} released to vendor (70%)`;
    case "DeliveryConfirmed":
      return `Payout #${a.payoutId}: beneficiary ${a.deliveries}/${a.required} proved delivery`;
    case "ImpactVerified":
      return `Payout #${a.payoutId}: impact verified · final ${rs(a.finalAmount)} paid`;
    case "FraudFlagged":
      return `${ngo(a.ngoId)} flagged: ${REASON[Number(a.reason)]}`;
    case "NGOFrozen":
      return `${ngo(a.ngoId)} auto-frozen by contract after ${a.flagCount} flags`;
    case "Discrepancy":
      return `${ngo(a.ngoId)} payout rejected: ${REASON[Number(a.reason)]} (not counted toward freeze)`;
    case "VendorSlashed":
      return `${label(a.vendor)} slashed ${rs(a.amount)}: signed the same invoice for two NGOs`;
    case "Challenged":
      return `${label(a.challenger)} challenged payout #${a.payoutId}`;
    case "Voted":
      return `${label(a.donor)} voted to ${a.uphold ? "uphold" : "reject"} the challenge on #${a.payoutId}`;
    case "ChallengeResolved":
      return `Challenge on #${a.payoutId} ${a.upheld ? `upheld · ${rs(a.reward)} paid to challenger` : "rejected · payout resumes"}`;
    case "PayoutUnwound":
      return `Payout #${a.payoutId} unwound · ${rs(a.returnedToLots)} back to donors`;
    case "Reclaimed":
      return `${label(a.donor)} reclaimed ${rs(a.amount)} from lot #${a.lotId}`;
    case "DonationSent":
      return `${label(a.donor)} sent ${rs(a.amount)} from chain B to the bridge`;
    case "DonationDelivered":
      return `Bridge delivered nonce ${a.nonce} as lot #${a.lotId}`;
    case "DonationSwapped":
      return `${label(a.donor)} swapped ${Number(BigInt(a.ethIn ?? 0)) / 1e18} ETH → ${rs(a.dinrOut)} on chain B for a donation`;
    case "FieldPartnerRegistered":
      return `${label(a.partner)} registered as an independent field partner`;
    case "BatchAttested":
      return `${label(a.partner)} vouched for ${a.cards} beneficiary cards for ${ngo(a.ngoId)}`;
    case "OffRampRegistered":
      return `${label(a.agent)} registered as a fiat payment agent`;
    case "FiatSettled":
      return `Payout #${a.payoutId}: ${label(a.agent)} proved ${rs(a.fiatAmount)} paid out in rupees`;
    case "UnexplainedTransfer":
      return `Payout #${a.payoutId}: never paid out in rupees · agent stake ${rs(a.reward)} → ${label(a.reporter)}`;
    default:
      return ev.name;
  }
}

/// Events that are bad news render dark; good news yellow; the rest neutral.
export function eventTone(name) {
  if (["FraudFlagged", "NGOFrozen", "VendorSlashed", "UnexplainedTransfer"].includes(name)) return "bad";
  if (["ImpactVerified", "PayoutReleased", "DeliveryConfirmed", "Donated", "CrossChainDonation", "FiatSettled", "DonationSwapped"].includes(name)) return "good";
  return "neutral";
}
