import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { liquid, snappy } from "../../lib/motion";
import { useApp, useTick } from "../../lib/store";
import { short } from "../../lib/chain";
import { inr } from "../../lib/format";
import { CheckIcon, CrossIcon, GavelIcon, HourglassIcon, SnowLockIcon } from "../icons";

/// ₹ amount, Indian digit grouping (see lib/format for the one money convention).
export function Rupees({ value, className = "" }) {
  return <span className={`tabular ${className}`}>{inr(value)}</span>;
}

export function Button({ children, variant = "primary", className = "", disabled, ...rest }) {
  const styles = {
    primary: "bg-obsidian text-white hover:bg-charcoal",
    signal: "bg-signal text-obsidian hover:bg-signal-soft",
    ghost: "bg-white text-obsidian border border-hairline hover:border-ash",
    danger: "bg-obsidian text-white hatch",
  }[variant];
  return (
    <motion.button
      whileHover={disabled ? undefined : "hover"}
      whileTap={disabled ? undefined : { scale: 0.97 }}
      transition={snappy}
      disabled={disabled}
      className={`inline-flex h-11 items-center justify-center gap-2 rounded-full px-5 text-[14px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${styles} ${className}`}
      {...rest}
    >
      {children}
    </motion.button>
  );
}

export function Field({ label, hint, children }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[13px] text-graphite">{label}</span>
      {children}
      {hint && <span className="text-[13px] text-graphite">{hint}</span>}
    </label>
  );
}

export function Input(props) {
  return (
    <input
      {...props}
      className={`h-11 rounded-[var(--radius-input)] border border-hairline bg-white px-4 text-[14px] outline-none transition-colors focus:border-obsidian ${props.className ?? ""}`}
    />
  );
}

/// Pill segmented control.
export function Segmented({ options, value, onChange, id }) {
  return (
    <div className="inline-flex flex-wrap gap-2">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <motion.button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            whileHover="hover"
            whileTap={{ scale: 0.97 }}
            className={`relative flex h-10 items-center gap-2 rounded-full border px-4 text-[14px] ${on ? "border-obsidian text-white" : "border-hairline bg-white text-ash"}`}
          >
            {on && <motion.span layoutId={`seg-${id}`} transition={liquid} className="absolute inset-0 rounded-full bg-obsidian" />}
            <span className="relative z-10 flex items-center gap-2">
              {o.icon}
              {o.label}
            </span>
          </motion.button>
        );
      })}
    </div>
  );
}

/// Page section with a hairline top border and an eyebrow label.
export function Section({ eyebrow, title, action, children, className = "" }) {
  return (
    <section className={`border-t border-hairline py-8 ${className}`}>
      {(eyebrow || title || action) && (
        <div className="mb-6 flex items-end justify-between gap-6">
          <div>
            {eyebrow && <div className="text-[13px] text-graphite">{eyebrow}</div>}
            {title && <h2 className="font-display text-[28px] leading-tight font-normal">{title}</h2>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

// Plain element: cards never move (moving text blurs it); hover feedback is a border colour change.
export function Card({ className = "", children, ...rest }) {
  return (
    <div className={`rounded-[var(--radius-card)] border border-hairline bg-paper transition-colors ${className}`} {...rest}>
      {children}
    </div>
  );
}

/// Status = fill + pattern + icon (never colour alone). Yellow = proven. Black = problem.
const STATUS = {
  Completed: { label: "Impact verified", cls: "bg-signal text-obsidian", icon: <CheckIcon size={14} /> },
  Released: { label: "Awaiting impact", cls: "border border-signal-deep bg-white text-obsidian", icon: <HourglassIcon size={14} /> },
  Pending: { label: "Challenge window", cls: "border border-signal-deep bg-white text-obsidian", icon: <HourglassIcon size={14} /> },
  // disputed, not fraud: the donors' vote is still open — outline only, fraud keeps the black hatch
  Challenged: { label: "Disputed · vote open", cls: "border border-dashed border-obsidian bg-white text-obsidian", icon: <GavelIcon size={14} /> },
  Cancelled: { label: "Cancelled · refunded", cls: "bg-charcoal text-white", icon: <CrossIcon size={14} /> },
  Frozen: { label: "Frozen", cls: "bg-obsidian text-white", icon: <SnowLockIcon size={14} /> },
  Fraud: { label: "Fraud", cls: "bg-obsidian text-white hatch", icon: <CrossIcon size={14} /> },
  Active: { label: "Active", cls: "bg-signal-mist text-obsidian border border-signal-deep", icon: <CheckIcon size={14} /> },
};
export function StatusBadge({ status, label }) {
  const s = STATUS[status] ?? { label: status, cls: "border border-hairline bg-white text-ash", icon: null };
  return (
    <span className={`inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium whitespace-nowrap ${s.cls}`}>
      {s.icon}
      {label ?? s.label}
    </span>
  );
}

/// Monospace hash, middle-truncated, click to copy.
export function HashText({ value, n = 4, className = "" }) {
  const [copied, setCopied] = useState(false);
  if (!value) return <span className="font-mono text-[13px] text-graphite">—</span>;
  return (
    <button
      type="button"
      title={value}
      onClick={() => {
        navigator.clipboard?.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
      className={`font-mono text-[13px] text-ash hover:text-obsidian ${className}`}
    >
      {copied ? "copied" : short(value, n)}
    </button>
  );
}

/// Seconds until a chain timestamp, using chain time.
export function Countdown({ until, done = "now" }) {
  useTick();
  const { chainNow } = useApp("chainNow");
  const s = until - chainNow();
  if (s <= 0) return <span className="tabular">{done}</span>;
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const text = d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${String(s % 60).padStart(2, "0")}s` : `${s}s`;
  return <span className="tabular">{text}</span>;
}

export function Empty({ children }) {
  return <div className="rounded-[var(--radius-tile)] border border-dashed border-hairline p-8 text-center text-[14px] text-graphite">{children}</div>;
}

/// Right-side drawer ("see the math").
export function Drawer({ open, onClose, title, children }) {
  // Escape closes the panel, like any side sheet
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div className="fixed inset-0 z-40 bg-obsidian/30" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.aside
            className="fixed top-0 right-0 z-50 flex h-full w-[520px] max-w-full flex-col border-l border-hairline bg-paper"
            initial={{ x: 540 }}
            animate={{ x: 0 }}
            exit={{ x: 540 }}
            transition={liquid}
          >
            <div className="flex items-center justify-between border-b border-hairline px-6 py-5">
              <h3 className="font-display text-[22px] font-normal">{title}</h3>
              <Button variant="ghost" onClick={onClose} className="h-9 px-4">
                Close
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-5" data-lenis-prevent>
              {children}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

/// Key/value row for drawers and detail panels.
export function KV({ k, children }) {
  return (
    <div className="flex items-start justify-between gap-6 border-b border-hairline py-3 text-[14px] last:border-b-0">
      <span className="text-graphite">{k}</span>
      <span className="text-right">{children}</span>
    </div>
  );
}

export function Toasts() {
  const { toasts } = useApp("toasts");
  return (
    <div className="pointer-events-none fixed right-6 bottom-6 z-[60] flex w-[360px] flex-col gap-2">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, x: 40 }}
            transition={liquid}
            className={`pointer-events-auto rounded-[var(--radius-tile)] border p-4 ${
              t.tone === "error" ? "hatch border-obsidian bg-obsidian text-white" : t.tone === "ok" ? "border-signal-deep bg-signal-mist" : "border-hairline bg-white"
            }`}
          >
            <div className="text-[14px] font-medium">{t.title}</div>
            <div className={`mt-0.5 text-[13px] ${t.tone === "error" ? "text-white/80" : "text-ash"}`}>{t.body}</div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

/// Shown when the acting role can't do this page's action.
export function RoleGate({ kinds, children }) {
  const { role, config } = useApp("role", "config");
  const kind = config && role ? (role.startsWith("donor") ? "Donor" : role.startsWith("ngo") ? "NGO" : role.startsWith("vendor") ? "Vendor" : role === "fieldWorker" ? "Field" : "Watcher") : null;
  if (kinds.includes(kind)) return children;
  return <Empty>Switch role (top right) to {kinds.join(" / ")} to use this page.</Empty>;
}
