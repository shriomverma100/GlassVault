import { motion } from "framer-motion";

/// Plain-language reasons for every on-chain fraud flag.
export const REASONS = {
  DuplicateInvoice: { title: "Duplicate invoice", text: "Same invoice already claimed (nullifier collision)" },
  ForgedSignature: { title: "Forged signature", text: "Vendor never signed this" },
  OutOfCategory: { title: "Out of category", text: "Money earmarked for another purpose" },
  OverBudget: { title: "Over budget", text: "Charged more than the donor lot holds" },
  AmountMismatch: { title: "Amount mismatch", text: "Lot shares don't add up to the invoice" },
  UnregisteredVendor: { title: "Unregistered vendor", text: "No staked vendor behind this invoice" },
  ChallengeUpheld: { title: "Challenge upheld", text: "Donors upheld a watcher challenge" },
  VendorDoubleSign: { title: "Vendor double-signed", text: "Same invoice signed for two NGOs — vendor stake slashed" },
  DuplicateFiatProof: { title: "Same bank transfer used twice", text: "One rupee payment claimed as proof for two payouts" },
  UnexplainedTransfer: { title: "Unexplained transfer", text: "Money released to a payment agent but never proven paid in rupees" },
};

export const ipfsHref = (uri) => (uri?.startsWith("ipfs://") ? `/ipfs/${uri.slice(7)}` : uri);

export const timeAgo = (unix, now) => {
  const s = Math.max(0, now - unix);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

/// Crack that propagates down a card when it mounts (pathLength draw).
export function CrackLine({ className = "" }) {
  return (
    <svg viewBox="0 0 40 120" className={className} fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <motion.path
        d="M22 0 L18 18 L26 30 L15 48 L24 62 L17 80 L27 96 L20 120"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1], delay: 0.15 }}
      />
      <motion.path d="M26 30 L34 36 M15 48 L6 52 M17 80 L9 86" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.5, delay: 0.8 }} />
    </svg>
  );
}

/// Small local icons (20px grid, 1.25 stroke) for the theatre panels.
const base = { width: 20, height: 20, viewBox: "0 0 20 20", fill: "none", stroke: "currentColor", strokeWidth: 1.25, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true };

export function PlayIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M6.5 4.5v11l9-5.5z" />
    </svg>
  );
}

export function BeakerIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M7.5 2.75h5M8.25 2.75v5L3.75 15.5a1.2 1.2 0 0 0 1 1.75h10.5a1.2 1.2 0 0 0 1-1.75L11.75 7.75v-5" />
      <path d="M5.5 12.5h9" />
    </svg>
  );
}

export function LinkIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M8.5 11.5l3-3M7 9.5L5.25 11.25a2.47 2.47 0 0 0 3.5 3.5L10.5 13M13 10.5l1.75-1.75a2.47 2.47 0 0 0-3.5-3.5L9.5 7" />
    </svg>
  );
}

export function Spinner({ size = 16 }) {
  return (
    <motion.svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: "linear" }} aria-hidden="true">
      <path d="M10 2.5a7.5 7.5 0 1 1-7.5 7.5" strokeLinecap="round" />
    </motion.svg>
  );
}
