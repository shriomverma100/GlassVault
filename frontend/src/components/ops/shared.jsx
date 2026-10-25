import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import QRCode from "qrcode";
import { api } from "../../lib/api";
import { useApp } from "../../lib/store";
import { liquid } from "../../lib/motion";
import { CheckIcon, CrossIcon } from "../icons";

export const FRAUD_REASONS = ["DuplicateInvoice", "ForgedSignature", "OutOfCategory", "OverBudget", "AmountMismatch", "UnregisteredVendor", "ChallengeUpheld", "VendorDoubleSign", "DuplicateFiatProof", "UnexplainedTransfer"];
export const humanize = (s = "") => s.replace(/([A-Z])/g, " $1").trim();
export const sameAddr = (a, b) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

/// GET a backend list and refetch whenever the live chain state changes.
export function useApiList(path) {
  const { state } = useApp("state");
  const [data, setData] = useState([]);
  const reload = useCallback(() => {
    if (!path) return;
    api.get(path).then(setData).catch(() => setData([]));
  }, [path]);
  useEffect(reload, [reload, state?.updatedAt]);
  return [data, reload];
}

/// Receipt CID for a fileHash: from the invoice (if the backend stored it) or from any payout's file index.
export function useReceiptCid(fileHash, invoice) {
  const { state } = useApp("state");
  return invoice?.cid ?? state?.payouts.find((p) => p.fileHash === fileHash && p.file)?.file?.cid ?? null;
}

/// One pre-check row: yellow check when it passes, hatched black cross when it fails.
export function CheckRow({ ok, pending, label, detail }) {
  return (
    <div className="flex items-start gap-3 border-b border-hairline py-3 last:border-b-0">
      <span
        className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full ${
          pending ? "border border-dashed border-hairline bg-white" : ok ? "bg-signal text-obsidian" : "hatch bg-obsidian text-white"
        }`}
      >
        {!pending && (ok ? <CheckIcon size={14} /> : <CrossIcon size={14} />)}
      </span>
      <div className="min-w-0">
        <div className="text-[14px] font-medium">{label}</div>
        {detail && <div className="mt-0.5 text-[13px] text-graphite">{detail}</div>}
      </div>
    </div>
  );
}

/// Circular progress (deliveries x / y). Fills in yellow like water rising around the ring.
export function ProgressRing({ value, max, size = 120, label }) {
  const r = (size - 10) / 2;
  const circ = 2 * Math.PI * r;
  const pct = max > 0 ? Math.min(1, value / max) : 0;
  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-hairline)" strokeWidth="1" />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--color-signal-deep)"
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={circ}
          initial={false}
          animate={{ strokeDashoffset: circ * (1 - pct) }}
          transition={liquid}
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="font-display text-[32px] leading-none font-normal tabular">
          {value}
          <span className="text-[16px] text-graphite">/{max}</span>
        </span>
        {label && <span className="mt-1 text-[12px] text-graphite">{label}</span>}
      </div>
    </div>
  );
}

/// Printable grid of beneficiary QR cards. Secrets are shown exactly once (only commitments are stored).
export function QrCards({ cards, label }) {
  const [urls, setUrls] = useState({});
  useEffect(() => {
    let live = true;
    Promise.all(cards.map((c) => QRCode.toDataURL(c.secret, { margin: 1, width: 220, color: { dark: "#121212", light: "#ffffff" } }))).then(
      (list) => live && setUrls(Object.fromEntries(list.map((u, i) => [cards[i].n, u]))),
    );
    return () => {
      live = false;
    };
  }, [cards]);
  return (
    <div>
      <div className="mb-4 rounded-[var(--radius-tile)] border border-obsidian bg-signal-mist p-4 text-[13px]">
        These secrets are shown <b>once</b>. Print or save them now — only their commitments are kept, so nobody (including GlassVault)
        can re-issue a card.
      </div>
      <div className="grid grid-cols-2 gap-3">
        {cards.map((c) => (
          <div key={c.n} className="rounded-[var(--radius-tile)] border border-hairline bg-white p-4">
            <div className="flex items-center justify-between text-[13px] text-graphite">
              <span>{label || "Beneficiary card"}</span>
              <span className="font-mono">#{String(c.n).padStart(3, "0")}</span>
            </div>
            {urls[c.n] ? <img src={urls[c.n]} alt={`QR card ${c.n}`} className="mx-auto my-3 h-40 w-40" /> : <div className="my-3 h-40" />}
            <div className="font-mono text-[12px] leading-tight break-all text-ash">{c.secret}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
