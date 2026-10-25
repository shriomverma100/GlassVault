import { useEffect, useRef, useState } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { LogoMark, EyeIcon, VaultIcon, InvoiceIcon, ShieldCheckIcon, WalletIcon, DropletIcon, QrIcon, UploadIcon } from "./icons";
import { liquid, snappy } from "../lib/motion";
import { useApp } from "../lib/store";
import { short } from "../lib/chain";

const ITEM = {
  explore: { to: "/", label: "Explore", icon: <DropletIcon /> },
  donate: { to: "/donate", label: "Donate", icon: <VaultIcon /> },
  myDonations: { to: "/passport", label: "My donations", icon: <ShieldCheckIcon /> },
  passports: { to: "/passport", label: "Passports", icon: <ShieldCheckIcon /> },
  ngo: { to: "/ngo", label: "NGO console", icon: <InvoiceIcon /> },
  vendor: { to: "/vendor", label: "Invoices", icon: <UploadIcon /> },
  field: { to: "/field", label: "Deliveries", icon: <QrIcon /> },
  watchtower: { to: "/watchtower", label: "Watchtower", icon: <EyeIcon /> },
};

// Each account sees its own workspace first; Explore, Passports and Watchtower are public to everyone.
const NAV = {
  public: ["explore", "passports", "watchtower"],
  Donor: ["explore", "donate", "myDonations", "watchtower"],
  NGO: ["ngo", "explore", "passports", "watchtower"],
  Vendor: ["vendor", "explore", "watchtower"],
  Field: ["field", "explore", "watchtower"],
  Watcher: ["watchtower", "explore", "passports"],
};

const H = 88;

// Obsidian header band with the smooth S-curve cut-out from the reference design.
export default function Header() {
  const { pathname } = useLocation();
  const { user } = useApp("user");
  const items = NAV[user?.kind ?? "public"].map((k) => ITEM[k]);
  const active = items.find((n) => (n.to === "/" ? pathname === "/" : pathname.startsWith(n.to)))?.to;
  return (
    <header className="sticky top-0 z-30 flex bg-bone" style={{ height: H }}>
      <NavLink to="/" className="flex items-center gap-3 pl-8 pr-4">
        <LogoMark />
        <span className="font-display text-[26px] font-medium tracking-tight">glassvault</span>
      </NavLink>

      <svg width="96" height={H} viewBox={`0 0 96 ${H}`} className="shrink-0" aria-hidden="true">
        <path d={`M0 0 C48 0 48 ${H} 96 ${H} L96 0 Z`} fill="var(--color-charcoal)" />
      </svg>

      <nav aria-label="Main" className="flex flex-1 items-center justify-between gap-4 bg-charcoal pr-6">
        <div className="flex items-center gap-1.5">
          {items.map((n) => {
            const on = n.to === active;
            return (
              <NavLink key={n.label} to={n.to}>
                <motion.span
                  whileHover="hover"
                  whileTap={{ scale: 0.97 }}
                  transition={snappy}
                  className={`relative flex h-11 items-center gap-2 rounded-full px-4 text-[14px] font-medium ${on ? "text-obsidian" : "bg-white/8 text-white/85 hover:text-white"}`}
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
        {user ? (
          <AccountMenu user={user} />
        ) : (
          <div className="flex items-center gap-2">
            <Link to="/login" className="flex h-11 items-center rounded-full px-5 text-[14px] font-medium text-white/85 hover:text-white">
              Sign in
            </Link>
            <Link to="/signup" className="flex h-11 items-center rounded-full bg-signal px-5 text-[14px] font-medium text-obsidian hover:bg-signal-soft">
              Create account
            </Link>
          </div>
        )}
      </nav>
    </header>
  );
}

function AccountMenu({ user }) {
  const { logout } = useApp("logout");
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  // close on outside click / Escape
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => !ref.current?.contains(e.target) && setOpen(false);
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex h-11 items-center gap-3 rounded-full bg-signal pr-5 pl-4 text-[14px] font-medium text-obsidian hover:bg-signal-soft"
      >
        <WalletIcon />
        <span className="flex flex-col items-start leading-tight">
          <span>{user.displayName}</span>
          <span className="text-[12px] text-obsidian/75">
            {user.kind} · <span className="font-mono">{short(user.address, 4)}</span>
          </span>
        </span>
      </button>
      {open && (
        <div role="menu" className="page-enter absolute top-14 right-0 z-50 w-[280px] rounded-[var(--radius-tile)] border border-hairline bg-paper p-2">
          <div className="px-3 py-2">
            <div className="text-[14px] font-medium">{user.displayName}</div>
            <div className="flex items-center gap-2 text-[13px] text-ash">
              @{user.username}
              <span className="rounded-full border border-hairline bg-white px-2 py-0.5 text-[12px] font-medium text-obsidian">
                {user.wallet === "metamask" ? "MetaMask" : "Password wallet"}
              </span>
            </div>
            <div className="mt-1 font-mono text-[12px] break-all text-ash">{user.address}</div>
          </div>
          <button
            role="menuitem"
            onClick={async () => {
              setOpen(false);
              await logout();
              navigate("/");
            }}
            className="w-full rounded-full px-3 py-2 text-left text-[14px] hover:bg-white"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
