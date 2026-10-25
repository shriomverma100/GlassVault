import { Countdown, HashText } from "./ui/kit";
import { inr } from "../lib/format";
import { short } from "../lib/chain";

// Amounts from the indexer are plain numbers; tolerate raw 18-decimal integers too.
const units = (v) => {
  const n = Number(v ?? 0);
  return n > 1e12 ? n / 1e18 : n;
};
const eth = (v) => `${Number(units(v).toFixed(4))} ETH`;

const DOT = {
  done: "bg-signal ring-1 ring-signal-deep",
  pending: "border border-hairline bg-white",
  disputed: "border border-dashed border-obsidian bg-white",
  bad: "hatch bg-obsidian",
};
const WORD = { done: null, pending: "pending", disputed: "disputed", bad: "problem" };

/// The full multi-hop timeline of one donation — chain B → swap → bridge → escrow → invoice → release →
/// rupee payout → delivery → impact — each hop with its transaction and time, built from chain state.
export default function Journey({ lot, payouts, trail, label, config, now, ngos }) {
  const hops = journeyHops({ lot, payouts, trail, label, config, now, ngos });
  return (
    <ol className="relative ml-3 border-l border-hairline">
      {hops.map((h, i) => (
        <li key={i} className="relative pb-6 pl-7 last:pb-0">
          <span className={`absolute top-1 -left-[7px] h-[13px] w-[13px] rounded-full ${DOT[h.status]}`} />
          <div className="flex flex-wrap items-baseline gap-x-3">
            <span className={`text-[15px] ${h.status === "bad" ? "font-medium" : ""}`}>{h.title}</span>
            {WORD[h.status] && <span className="text-[13px] font-medium text-ash">· {WORD[h.status]}</span>}
          </div>
          {h.sub && <div className="mt-0.5 text-[14px] text-ash">{h.sub}</div>}
          {(h.time || h.tx) && (
            <div className="mt-1 flex flex-wrap gap-3 text-[13px] text-graphite">
              {h.time ? <span>{new Date(h.time * 1000).toLocaleString("en-IN")}</span> : null}
              {h.chain && <span>chain {h.chain}</span>}
              {h.tx && <HashText value={h.tx} />}
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}

export function journeyHops({ lot, payouts, trail = [], label, config, now, ngos = [] }) {
  const ngoName = (id) => ngos[id]?.name ?? `NGO #${id}`;
  const A = config.chainA.chainId;
  const ev = (name, pred = () => true) => trail.filter((e) => e.name === name && pred(e)).at(-1);
  const forPayout = (id) => (e) => Number(e.args.payoutId) === id;
  const at = (e) => (e ? { tx: e.tx, time: e.time, chain: e.chainId } : {});
  const o = lot.origin;
  const bridged = lot.sourceChain !== A;
  const hops = [];

  // ① inbound — possibly multi-hop
  if (o?.asset === "ETH") {
    hops.push({ status: "done", title: `Donated ${eth(o.ethIn)} on chain ${o.sourceChain}`, sub: `by ${label(lot.donor)}`, tx: o.sendTx ?? o.swapTx, chain: o.sourceChain });
    hops.push({ status: "done", title: `Swapped to ${inr(units(o.dinrOut))} at the exchange`, sub: "ETH → dINR on chain B, in the same transaction", tx: o.swapTx, chain: o.sourceChain });
  } else if (bridged) {
    hops.push({ status: "done", title: `Sent ${inr(lot.amount)} over the bridge from chain ${lot.sourceChain}`, sub: `by ${label(lot.donor)}`, tx: o?.sendTx, chain: lot.sourceChain });
  }
  const arrive = bridged ? ev("CrossChainDonation") ?? ev("Donated") : ev("Donated");
  hops.push({
    status: "done",
    title: bridged ? `Bridged to chain ${A} · now lot #${lot.id} in escrow` : `Donated ${inr(lot.amount)} · lot #${lot.id} in escrow`,
    sub: `${lot.category} only · donor tag kept${bridged ? " across the bridge" : ""}`,
    ...at(arrive),
    tx: o?.deliverTx ?? arrive?.tx,
  });
  if (lot.redirectedFrom != null) {
    hops.push({ status: "done", title: `Arrived from donation #${lot.redirectedFrom} (fallback)`, sub: "The first NGO was frozen or missed its deadline — the donor's chosen fallback took over", ...at(ev("LotRedirected")) });
  }

  // ②–④ every payout this lot funded
  for (const p of [...payouts].sort((a, b) => a.id - b.id)) {
    const by = label(p.vendor);
    hops.push({ status: "done", title: `Invoice signed by ${by} · payout #${p.id}`, sub: `${inr(p.share)} of ${inr(p.amount)} charged to this lot`, ...at(ev("PayoutRequested", forPayout(p.id))) });

    if (p.status === "Challenged") hops.push({ status: "disputed", title: "Disputed — the donors of this payout are voting" });
    else if (p.status === "Pending") hops.push({ status: "pending", title: "Waiting out the public challenge window", sub: <>releasable in <Countdown until={p.releaseAt} done="now" /></> });

    const released = ev("PayoutReleased", forPayout(p.id));
    if (released || p.paid > 0) hops.push({ status: "done", title: `70% (${inr(Math.round(p.amount * 0.7))}) released to ${by}`, ...at(released) });

    if (p.offRamp && (released || p.paid > 0)) {
      if (p.fiat) {
        hops.push({
          status: "done",
          title: `Paid ${inr(units(p.fiat.fiatAmount))} in rupees to a local vendor`,
          sub: `payee ${short(p.fiat.payeeHash, 4)} · bank ref ${short(p.fiat.bankRefHash, 4)} · signed by ${by}`,
          tx: p.fiat.tx,
          time: p.fiat.paidAt,
        });
      } else if (p.unexplained) {
        hops.push({ status: "bad", title: "Unexplained transfer — never proven paid in rupees", sub: "The agent's stake went to whoever flagged it; the NGO got a fraud flag.", tx: p.unexplained.tx });
      } else if (p.fiatDeadline && now > p.fiatDeadline) {
        hops.push({ status: "bad", title: "Overdue — not settled in rupees", sub: "Anyone can now flag this as an unexplained transfer." });
      } else {
        hops.push({ status: "pending", title: "Awaiting proof of the rupee payment", sub: p.fiatDeadline ? <>due in <Countdown until={p.fiatDeadline} done="now" /></> : null });
      }
    }

    if (p.status === "Cancelled") {
      if (p.impactExpired) {
        hops.push({ status: "bad", title: "Delivery never proven — unpaid 30% returned to donors", sub: "No beneficiary proof by the impact deadline", tx: p.impactExpired.tx, ...at(ev("ImpactExpired", forPayout(p.id))) });
      } else {
        hops.push({ status: "bad", title: "Payout cancelled — unpaid money returned to the donors' lots", ...at(ev("PayoutUnwound", forPayout(p.id))) });
      }
      continue;
    }
    if (p.deliveriesRequired > 0) {
      const done = p.deliveries >= p.deliveriesRequired;
      const due = !done && p.status === "Released" && p.impactDeadline ? <> · due in <Countdown until={p.impactDeadline} done="now — unproven 30% can be returned" /></> : null;
      hops.push({ status: done ? "done" : "pending", title: `${p.deliveries}/${p.deliveriesRequired} beneficiaries confirmed delivery`, sub: <>QR cards checked against the approved list — no names on-chain{due}</>, ...at(ev("DeliveryConfirmed", forPayout(p.id))) });
    }
    if (p.status === "Completed") hops.push({ status: "done", title: "Impact verified · final 30% paid", sub: "Every donor of this payout received a Proof-of-Impact token", ...at(ev("ImpactVerified", forPayout(p.id))) });
  }

  if (lot.redirectedTo != null) {
    hops.push({ status: "done", title: `Redirected to ${ngoName(lot.fallbackNgoId)} as donation #${lot.redirectedTo}`, sub: "Unspent funds moved to the donor's fallback NGO — same purpose", ...at(ev("LotRedirected")) });
  } else if (lot.remaining > 0) {
    const after = lot.fallbackNgoId != null ? `moves to ${ngoName(lot.fallbackNgoId)}` : "the donor can reclaim it";
    hops.push({ status: "pending", title: `${inr(lot.remaining)} still in escrow`, sub: `Unspent by the deadline or if the NGO is frozen → ${after}` });
  }
  return hops;
}
