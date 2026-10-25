import { motion } from "framer-motion";
import { snappy, liquid } from "../../lib/motion";

// White circular icon holder (the "Aspirin" orb in the reference).
export function IconOrb({ children, dark = false, size = 44 }) {
  return (
    <span
      className={`inline-grid shrink-0 place-items-center rounded-full ${
        dark ? "bg-charcoal text-white" : "bg-white text-obsidian"
      }`}
      style={{ width: size, height: size }}
    >
      {children}
    </span>
  );
}

// Pill tabs with a liquid sliding active pill (shared layoutId).
export function PillTabs({ tabs, active, onChange, id = "tabs", dark = false }) {
  return (
    <div className="flex items-center gap-2">
      {tabs.map((t) => {
        const on = t.key === active;
        return (
          <motion.button
            key={t.key}
            onClick={() => onChange(t.key)}
            whileHover="hover"
            whileTap={{ scale: 0.97 }}
            transition={snappy}
            className={`relative flex h-11 items-center gap-2 rounded-full px-5 text-[14px] font-medium transition-colors ${
              on ? "text-obsidian" : dark ? "text-white/80 bg-white/10" : "text-ash bg-paper"
            }`}
          >
            {on && (
              <motion.span
                layoutId={`${id}-pill`}
                transition={liquid}
                className="absolute inset-0 rounded-full bg-white"
              />
            )}
            <span className="relative z-10 flex items-center gap-2">
              {t.icon}
              {t.label}
            </span>
          </motion.button>
        );
      })}
    </div>
  );
}

// Big number with a small unit — "89 bpm" style from the reference. Regular weight, not light:
// thin strokes on the bone background blur on Windows ClearType.
export function KpiStat({ label, value, unit }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[13px] font-medium text-ash">{label}</span>
      <span className="font-display text-[40px] leading-none font-normal tracking-tight text-obsidian tabular">
        {value}
        {unit && <span className="ml-1 text-[18px] font-medium text-graphite">{unit}</span>}
      </span>
    </div>
  );
}

// Hover only recolours the border: moving a card shifts its text by sub-pixels and blurs it.
export function HairlineCard({ className = "", children }) {
  return <div className={`rounded-[var(--radius-card)] border border-hairline bg-paper transition-colors hover:border-ash/40 ${className}`}>{children}</div>;
}
