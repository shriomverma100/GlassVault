import { useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { LogoMark, EyeIcon, VaultIcon, InvoiceIcon, ShieldCheckIcon, WalletIcon, DropletIcon, QrIcon, UploadIcon } from "./icons";
import { liquid, snappy } from "../lib/motion";
import { useApp } from "../lib/store";
import { ROLE_META, short } from "../lib/chain";

const NAV = [
  { to: "/", label: "Explore", icon: <DropletIcon /> },
  { to: "/donate", label: "Donate", icon: <VaultIcon /> },
  { to: "/passport", label: "Passport", icon: <ShieldCheckIcon /> },
  { to: "/ngo", label: "NGO", icon: <InvoiceIcon /> },
  { to: "/vendor", label: "Vendor", icon: <UploadIcon /> },
  { to: "/field", label: "Field", icon: <QrIcon /> },
  { to: "/watchtower", label: "Watchtower", icon: <EyeIcon /> },
];

const H = 88;

// Obsidian header band with the smooth S-curve cut-out from the reference design.
export default function Header() {
  const { pathname } = useLocation();
  const active = NAV.find((n) => (n.to === "/" ? pathname === "/" : pathname.startsWith(n.to)))?.to;
  return (
    <header className="sticky top-0 z-30 flex bg-bone" style={{ height: H }}>
      <NavLink to="/" className="flex items-center gap-3 pl-8 pr-4">
        <LogoMark />
        <span className="font-display text-[26px] font-medium tracking-tight">glassvault</span>
      </NavLink>

      <svg width="96" height={H} viewBox={`0 0 96 ${H}`} className="shrink-0" aria-hidden="true">
        <path d={`M0 0 C48 0 48 ${H} 96 ${H} L96 0 Z`} fill="var(--color-charcoal)" />
      </svg>

      <nav className="flex flex-1 items-center justify-between gap-4 bg-charcoal pr-6">
        <div className="flex items-center gap-1.5">
          {NAV.map((n) => {
            const on = n.to === active;
            return (
              <NavLink key={n.to} to={n.to}>
                <motion.span
                  whileHover="hover"
                  whileTap={{ scale: 0.97 }}
                  transition={snappy}
                  className={`relative flex h-11 items-center gap-2 rounded-full px-4 text-[14px] font-medium ${on ? "text-obsidian" : "bg-white/8 text-white/75 hover:text-white"}`}
                >
                  {on && <motion.span layoutId="nav-pill" transition={liquid} className="absolute inset-0 rounded-full bg-white" />}
                  <span className="relative z-10 flex items-center gap-2">
                    {n.icon}
                    {n.label}
                  </span>
                </motion.span>
              </NavLink>
            );
          })}
        </div>
        <RoleSwitcher />
      </nav>
    </header>
  );
}

/// Acting identity. Each role is a real funded account on the local chains; all actions are signed txs.
function RoleSwitcher() {
  const { role, switchRole, config, address } = useApp("role", "switchRole", "config", "address");
  const [open, setOpen] = useState(false);
  const meta = ROLE_META[role];
  const groups = ["Donor", "NGO", "Vendor", "Field", "Watcher"];
  return (
    <div className="relative">
      <motion.button
        whileHover="hover"
        whileTap={{ scale: 0.97 }}
        transition={snappy}
        onClick={() => setOpen((o) => !o)}
        className="flex h-11 items-center gap-3 rounded-full bg-signal pr-5 pl-4 text-[14px] font-medium text-obsidian"
      >
        <WalletIcon />
        <span className="flex flex-col items-start leading-tight">
          <span>{meta?.label}</span>
          <span className="font-mono text-[12px] opacity-70">{short(address ?? "", 4)}</span>
        </span>
      </motion.button>
      <AnimatePresence>
        {open && config && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6 }}
            transition={liquid}
            className="absolute top-14 right-0 z-50 w-[300px] rounded-[var(--radius-tile)] border border-hairline bg-paper p-2"
          >
            <div className="px-3 py-2 text-[13px] text-graphite">Act as — every role is a real wallet on the local chain</div>
            {groups.map((g) => (
              <div key={g} className="border-t border-hairline py-1">
                {Object.entries(ROLE_META)
                  .filter(([, m]) => m.kind === g)
                  .map(([r, m]) => (
                    <button
                      key={r}
                      onClick={() => {
                        switchRole(r);
                        setOpen(false);
                      }}
                      className={`flex w-full items-center justify-between rounded-full px-3 py-2 text-left text-[14px] hover:bg-white ${r === role ? "bg-signal-mist" : ""}`}
                    >
                      <span>
                        {m.label} <span className="text-graphite">· {m.kind}</span>
                      </span>
                      <span className="font-mono text-[12px] text-graphite">{short(config.roles[r]?.address ?? "", 3)}</span>
                    </button>
                  ))}
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
