import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { useApp } from "../lib/store";
import { HOME } from "../lib/wallet";
import { Button, Field, Input } from "../components/ui/kit";
import { discoverWallet } from "../lib/metamask";
import { DEMO_ACCOUNTS } from "../lib/demo-accounts";
import { EthereumLogo } from "../components/brand";
import { VaultIcon, InvoiceIcon, UploadIcon, QrIcon, EyeIcon } from "../components/icons";

export default function Login() {
  const { login, loginWithMetaMask, config } = useApp("login", "loginWithMetaMask", "config");
  const localChains = config?.chainA?.chainId === 31337 && config?.chainB?.chainId === 31338;
  const navigate = useNavigate();
  const from = useLocation().state?.from;
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const [mm, setMm] = useState(undefined); // undefined = still looking, null = no wallet
  useEffect(() => {
    discoverWallet().then(setMm);
  }, []);

  async function withMetaMask() {
    setBusy(true);
    setError(null);
    try {
      const out = await loginWithMetaMask();
      if (out.needsSignup) return navigate("/signup", { state: { mm: { signupToken: out.signupToken, address: out.address } } });
      navigate(from ?? HOME[out.user.kind], { replace: true });
    } catch (err) {
      setError(err.shortMessage ?? err.message);
    } finally {
      setBusy(false);
    }
  }

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const user = await login(username, password);
      navigate(from ?? HOME[user.kind], { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      split
      title="Sign in"
      sub="With MetaMask, or with your username and password (your wallet is then unlocked in this browser and never leaves encrypted form)."
      aside={<SignInExplainer />}
    >
      <div className="rounded-[var(--radius-card)] border border-hairline bg-paper p-6">
        <div className="flex flex-col gap-2">
          <Button type="button" variant="signal" disabled={busy || !mm} onClick={withMetaMask}>
            <span aria-hidden="true" className="contents">
              <EthereumLogo size={16} />
            </span>
            {mm === null ? "Install MetaMask to use it" : busy ? "Waiting for MetaMask…" : "Continue with MetaMask"}
          </Button>
          <p className="text-[13px] text-graphite">
            Signs a one-time message — no transaction, no fee. Local chains: if MetaMask shows a nonce error after the chain restarted, open MetaMask → Settings →
            Advanced → Clear activity tab data.
          </p>
        </div>
        <div className="my-6 flex items-center gap-3 text-[13px] text-graphite">
          <span className="h-px flex-1 bg-hairline" />
          or with a password
          <span className="h-px flex-1 bg-hairline" />
        </div>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <Field label="Username">
            <Input autoFocus autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required />
          </Field>
          <Field label="Password">
            <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </Field>
          <AnimatePresence>
            {error && (
              <motion.p
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="rounded-[var(--radius-input)] bg-obsidian px-4 py-3 text-[14px] text-white"
              >
                {error}
              </motion.p>
            )}
          </AnimatePresence>
          <Button type="submit" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </Button>
          <p className="text-[14px] text-ash">
            New here?{" "}
            <Link to="/signup" className="font-medium text-obsidian underline underline-offset-4">
              Create an account
            </Link>
          </p>
        </form>
      </div>
      {localChains && (
        <DemoAccounts
          picked={username}
          onPick={(u, pw) => {
            setUsername(u);
            setPassword(pw);
            setError(null);
          }}
        />
      )}
    </AuthShell>
  );
}

const KIND_ICON = { Donor: <VaultIcon />, NGO: <InvoiceIcon />, Vendor: <UploadIcon />, Field: <QrIcon />, Watcher: <EyeIcon /> };
const KIND_LABEL = { Donor: "Donors", NGO: "NGOs", Vendor: "Vendors & fiat agent", Field: "Field partner", Watcher: "Watcher" };

const SIGN_IN_STEPS = [
  { t: "Prove it's you", d: "MetaMask signs a one-time Sign-In with Ethereum message (EIP-4361), or your password unlocks your encrypted wallet in this browser." },
  { t: "Land in your workspace", d: "Donor → My donations · NGO → NGO console · Vendor → Invoices · Field partner → Deliveries · Watcher → Watchtower." },
  { t: "Every action is signed", d: "Donations, invoices and deliveries are signed by your wallet and checked by the contract. Nobody can act in your name." },
];

/// What signing in actually does — three steps on a structure line.
function SignInExplainer() {
  return (
    <div className="rounded-[var(--radius-card)] bg-charcoal p-8 text-white">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-full bg-white">
          <EthereumLogo size={22} />
        </span>
        <div>
          <div className="text-[13px] text-white/60">Your key, your account</div>
          <div className="font-display text-[22px] leading-tight">What happens when you sign in</div>
        </div>
      </div>
      <ol className="relative mt-8 flex flex-col gap-6 pl-9">
        <span aria-hidden="true" className="absolute top-2 bottom-2 left-[11px] w-px bg-white/20" />
        {SIGN_IN_STEPS.map((s, i) => (
          <motion.li
            key={s.t}
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.08 * i, duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className="relative"
          >
            <span className="absolute top-0 -left-9 grid h-6 w-6 place-items-center rounded-full bg-signal font-mono text-[12px] text-obsidian">{i + 1}</span>
            <div className="text-[15px] font-medium">{s.t}</div>
            <p className="mt-1 text-[14px] leading-relaxed text-white/70">{s.d}</p>
          </motion.li>
        ))}
      </ol>
      <div className="mt-8 rounded-[var(--radius-tile)] border border-white/15 p-4 text-[13px] leading-relaxed text-white/70">
        The server stores only your encrypted wallet and a password hash — never a private key. Sign-in messages are bound to this site, so they can't be replayed elsewhere.
      </div>
    </div>
  );
}

/// Seeded logins for the local chains, grouped by role — click one to fill the form (it does not sign in).
function DemoAccounts({ onPick, picked }) {
  return (
    <details open data-tour="login-demo" className="group mt-6 rounded-[var(--radius-card)] border border-hairline bg-paper">
      <summary className="flex cursor-pointer list-none items-center justify-between px-6 py-4 text-[15px] font-medium">
        Demo accounts (local chains only)
        <span aria-hidden="true" className="text-graphite transition-transform group-open:rotate-180">
          ▾
        </span>
      </summary>
      <div className="border-t border-hairline px-4 pt-3 pb-4">
        <p className="px-2 pb-3 text-[13px] text-ash">Public test credentials for the local demo chain — click one to fill the form. Never use them on a real network.</p>
        <div className="flex flex-col gap-4">
          {Object.keys(KIND_ICON).map((kind) => (
            <div key={kind}>
              <div className="mb-1.5 flex items-center gap-2 px-2 text-[12px] font-medium tracking-wide text-graphite uppercase">
                {KIND_ICON[kind]}
                {KIND_LABEL[kind]}
              </div>
              <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {DEMO_ACCOUNTS.filter((a) => a[2] === kind).map(([username, , , displayName, password, shows]) => (
                  <li key={username}>
                    <button
                      type="button"
                      onClick={() => onPick(username, password)}
                      title={shows}
                      className={`w-full rounded-[14px] border px-3 py-2 text-left transition-[border-color,background-color,box-shadow] ${
                        picked === username ? "border-signal-deep bg-signal-mist" : "border-transparent bg-white hover:border-hairline hover:shadow-[0_8px_22px_-18px_rgb(18_18_18/0.4)]"
                      }`}
                    >
                      <span className="block text-[14px] font-medium">
                        {displayName} <span className="font-normal text-ash">· {kind}</span>
                      </span>
                      <span className="block font-mono text-[12px] text-ash">
                        {username} / {password}
                      </span>
                      <span className="block truncate text-[12px] text-graphite">{shows}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </details>
  );
}

export function AuthShell({ title, sub, children, wide = false, split = false, aside = null }) {
  if (split)
    return (
      <div className="mx-auto grid max-w-[1120px] grid-cols-1 gap-10 pt-12 lg:grid-cols-[minmax(0,520px)_1fr]">
        <div>
          <h1 className="font-display text-[48px] leading-none font-normal tracking-tight">{title}</h1>
          <p className="mt-3 mb-8 text-[15px] text-ash">{sub}</p>
          {children}
        </div>
        <div className="lg:sticky lg:top-[112px] lg:self-start">{aside}</div>
      </div>
    );
  return (
    <div className={`mx-auto pt-14 ${wide ? "max-w-[880px]" : "max-w-[440px]"}`}>
      <h1 className="font-display text-[48px] leading-none font-normal tracking-tight">{title}</h1>
      <p className="mt-3 mb-8 text-[15px] text-ash">{sub}</p>
      {children}
    </div>
  );
}
