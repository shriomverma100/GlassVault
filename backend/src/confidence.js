/// Probabilistic evaluation chain (PS 4.2): Inbound Donation → Escrow Condition → Cryptographic Impact
/// Verification → Off-Chain Invoice Proof.
///
/// Each stage gets a probability in [0, 1] from the evidence that exists for it: on-chain facts (signed
/// invoices, nullifiers, card signatures, fiat settlements, challenges, freezes) and the open watcher's
/// signals (near-duplicate receipts, Benford drift). Every factor is a named multiplier, so anyone can
/// see why a hop is 0.94 and not 1.0. The chain confidence is the product of the stages.
///
/// Pure and deterministic: same chain state + same watcher findings → same numbers. It is informational
/// only — money moves and freezes solely by contract rules, so this is not a central auditor.
export const FORMULA_VERSION = "1.0";

const round = (x) => Math.round(x * 1000) / 1000;
const product = (factors) => factors.reduce((p, f) => p * f.weight, 1);
const f = (text, weight = 1) => ({ text, weight });

/// Inbound donation: the deposit itself and, for multi-hop donations, every hop before it.
function inbound(lot, ctx) {
  const factors = [f("Deposit recorded on-chain with donor, NGO, purpose and deadline")];
  if (lot.sourceChain !== ctx.homeChainId) {
    const o = lot.origin;
    if (o?.asset === "ETH") factors.push(f(`${o.ethIn} ETH swapped at the exchange — swap event on chain ${o.sourceChain}`));
    factors.push(f("Bridged by a single trusted relayer (a light client / CCIP removes this trust)", 0.97));
    if (!o?.deliverTx || !o?.sendTx) factors.push(f("Bridge hop not fully reconstructed from events", 0.9));
  }
  if (lot.redirectedFrom !== null && lot.redirectedFrom !== undefined) factors.push(f(`Arrived from donation #${lot.redirectedFrom} through the donor's fallback`));
  return { key: "inbound", label: "Inbound Donation", status: "proven", factors };
}

/// Escrow condition: the money is held by rules no person can override.
function escrow(lot, ctx) {
  const factors = [f("Held by the contract — no admin key can move or unfreeze it"), f("Contract code not yet externally audited", 0.99)];
  const ngo = ctx.ngos[lot.ngoId];
  if (ngo?.frozen) factors.push(f("NGO frozen — unspent money can only return to the donor or their fallback"));
  if (lot.redirectedTo !== null && lot.redirectedTo !== undefined) factors.push(f(`Unspent money moved to donation #${lot.redirectedTo} (dead-man switch)`));
  return { key: "escrow", label: "Escrow Condition", status: "proven", factors };
}

/// Cryptographic impact verification for one payout.
function impactOf(p, ctx) {
  if (p.impactExpired) return { p: 0, status: "failed", factors: [f(`Payout #${p.id}: delivery never proven — unpaid 30% returned to donors`, 0)] };
  if (p.status === "Cancelled") return { p: 0, status: "failed", factors: [f(`Payout #${p.id} cancelled before impact was proven`, 0)] };
  const batch = ctx.batches.get(String(p.beneficiaryRoot).toLowerCase());
  const factors = [];
  if (batch) factors.push(f(`Card list attested by an independent, staked field partner (collusion with the NGO not ruled out)`, 0.97));
  else factors.push(f("Card list attestation not found", 0.8));
  if (p.status === "Completed") {
    factors.unshift(f(`${p.deliveries}/${p.deliveriesRequired} beneficiaries confirmed by card signatures`));
    return { p: product(factors), status: "proven", factors };
  }
  const r = p.deliveriesRequired ? Math.min(1, p.deliveries / p.deliveriesRequired) : 0;
  // not yet proven: an even prior that rises with every confirmed handover
  factors.unshift(f(`${p.deliveries}/${p.deliveriesRequired} deliveries confirmed so far`, 0.5 + 0.5 * r));
  return { p: product(factors), status: "pending", factors };
}

/// Off-chain invoice proof for one payout (incl. the fiat off-ramp leg).
function invoiceOf(p, ctx) {
  if (p.unexplained) return { p: 0, status: "failed", factors: [f(`Payout #${p.id}: released but never proven paid in rupees (unexplained transfer)`, 0)] };
  if (p.challenge?.resolved && p.challenge.upheld) return { p: 0, status: "failed", factors: [f(`Payout #${p.id}: donors upheld a fraud challenge`, 0)] };
  const factors = [f(`Payout #${p.id}: vendor-signed invoice with a globally unique nullifier — checked by the contract`)];
  const vendor = ctx.vendors.get(String(p.vendor).toLowerCase());
  if (vendor?.slashed) factors.push(f("Vendor was later slashed for fraud", 0.3));
  if (!ctx.files[p.fileHash]) factors.push(f("Receipt file not retrievable by its hash", 0.9));
  if (ctx.nearDuplicate.has(p.id)) factors.push(f("Watcher: receipt image matches another invoice", 0.4));
  if (p.status === "Challenged") factors.push(f("Disputed — donors are voting", 0.6));
  else if (p.challenge?.resolved) factors.push(f("Survived a challenge: donors rejected it"));
  if (p.status === "Pending" && ctx.now < p.releaseAt) factors.push(f("Public challenge window still open", 0.95));
  if (p.offRamp) {
    if (p.fiat) factors.push(f("Rupee payment proven by the staked agent's signature (bank reference used once)", 0.95));
    else if (p.fiatDeadline && ctx.now > p.fiatDeadline) factors.push(f("Rupee payment overdue — can be flagged as unexplained", 0.5));
    else factors.push(f("Awaiting proof of the rupee payment to the local vendor", 0.85));
  }
  const benford = ctx.benford.get(p.ngoId);
  if (benford === "nonconforming") factors.push(f("Watcher: NGO's invoice amounts don't follow Benford's law", 0.85));
  else if (benford === "marginal") factors.push(f("Watcher: NGO's invoice amounts drift from Benford's law", 0.95));
  const ngo = ctx.ngos[p.ngoId];
  if (ngo?.flagCount) factors.push(f(`NGO has ${ngo.flagCount} fraud flag(s)`, Math.max(0.5, 1 - 0.1 * ngo.flagCount)));
  const disc = ctx.discrepancies.get(p.ngoId) ?? 0;
  if (disc) factors.push(f(`NGO has ${disc} recorded discrepanc${disc === 1 ? "y" : "ies"}`, Math.max(0.85, 1 - 0.03 * disc)));
  const pending = p.status === "Pending" || p.status === "Challenged" || (p.offRamp && !p.fiat && p.status !== "Completed");
  return { p: product(factors), status: pending ? "pending" : "proven", factors };
}

/// Spend-weighted stage over the payouts that used this lot's money.
function spendStage(key, label, lot, spends, pick) {
  if (!spends.length) return { key, label, p: null, status: "n/a", factors: [f("No money from this donation has been spent yet")] };
  const total = spends.reduce((a, s) => a + s.money, 0);
  const parts = spends.map((s) => ({ ...pick(s.payout), w: s.money / total }));
  const p = parts.reduce((a, x) => a + x.w * x.p, 0);
  const status = parts.some((x) => x.status === "failed") ? "failed" : parts.some((x) => x.status === "pending") ? "pending" : "proven";
  return { key, label, p: round(p), status, factors: parts.flatMap((x) => x.factors) };
}

/// Builds the lookups every lot needs once per state snapshot.
export function context(state, { homeChainId, findings = [], files = {}, now = Math.floor(Date.now() / 1000) }) {
  const nearDuplicate = new Set();
  const benford = new Map();
  // findings are newest first: keep the latest Benford verdict per NGO
  for (const x of findings) {
    if (x.kind === "challenge" && x.evidence?.some((e) => e.check === "near-duplicate-receipt")) nearDuplicate.add(x.payoutId);
    if (x.kind === "benford" && !benford.has(x.ngoId)) benford.set(x.ngoId, x.verdict);
  }
  const discrepancies = new Map();
  for (const d of state.discrepancies ?? []) discrepancies.set(d.ngoId, (discrepancies.get(d.ngoId) ?? 0) + 1);
  return {
    homeChainId,
    now,
    files,
    nearDuplicate,
    benford,
    discrepancies,
    ngos: state.ngos,
    vendors: new Map(state.vendors.map((v) => [String(v.address).toLowerCase(), v])),
    batches: new Map((state.batches ?? []).map((b) => [String(b.root).toLowerCase(), b])),
  };
}

export function lotConfidence(lot, state, ctx) {
  // money from this lot that actually went into each payout (a cancelled payout only kept what it paid)
  const spends = state.payouts
    .map((payout) => {
      const share = payout.shares.filter((s) => s.lotId === lot.id).reduce((a, s) => a + s.amount, 0);
      const money = payout.status === "Cancelled" ? (payout.amount ? (share * payout.paid) / payout.amount : 0) : share;
      return { payout, money };
    })
    .filter((s) => s.money > 0);

  const inb = inbound(lot, ctx);
  const esc = escrow(lot, ctx);
  const stages = [
    { ...inb, p: round(product(inb.factors)) },
    { ...esc, p: round(product(esc.factors)) },
    spendStage("impact", "Cryptographic Impact Verification", lot, spends, (p) => impactOf(p, ctx)),
    spendStage("invoice", "Off-Chain Invoice Proof", lot, spends, (p) => invoiceOf(p, ctx)),
  ];
  const score = round(stages.reduce((a, s) => a * (s.p ?? 1), 1));
  const spent = spends.reduce((a, s) => a + s.money, 0);
  return {
    score,
    provisional: stages.some((s) => s.status === "pending" || s.status === "n/a"),
    spentShare: lot.amount ? round(Math.min(1, spent / lot.amount)) : 0,
    stages,
  };
}

/// Adds lot.confidence, ngo.confidence and stats.confidence to a state snapshot (money-weighted).
export function annotate(state, opts) {
  const ctx = context(state, opts);
  for (const lot of state.lots) lot.confidence = lotConfidence(lot, state, ctx);
  const weighted = (lots) => {
    const total = lots.reduce((a, l) => a + l.amount, 0);
    return total ? round(lots.reduce((a, l) => a + l.amount * l.confidence.score, 0) / total) : null;
  };
  for (const ngo of state.ngos) {
    const lots = state.lots.filter((l) => l.ngoId === ngo.id);
    ngo.confidence = { score: weighted(lots), lots: lots.length };
  }
  state.stats.confidence = { mean: weighted(state.lots), formulaVersion: FORMULA_VERSION };
  return state;
}
