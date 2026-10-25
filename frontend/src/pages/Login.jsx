import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useApp } from "../lib/store";
import { HOME } from "../lib/wallet";
import { Button, Field, Input } from "../components/ui/kit";
import { discoverWallet } from "../lib/metamask";
import { DEMO_ACCOUNTS } from "../lib/demo-accounts";

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
    <AuthShell title="Sign in" sub="With MetaMask, or with your username and password (your wallet is then unlocked in this browser and never leaves encrypted form).">
      <div className="mb-6 flex flex-col gap-2">
        <Button type="button" variant="signal" disabled={busy || !mm} onClick={withMetaMask}>
          {mm === null ? "Install MetaMask to use it" : busy ? "Waiting for MetaMask…" : "Continue with MetaMask"}
        </Button>
        <p className="text-[13px] text-graphite">
          Signs a one-time message — no transaction, no fee. Local chains: if MetaMask shows a nonce error after the chain restarted, open MetaMask → Settings →
          Advanced → Clear activity tab data.
        </p>
      </div>
      <div className="mb-6 flex items-center gap-3 text-[13px] text-graphite">
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
        {error && <p className="rounded-[var(--radius-input)] bg-obsidian px-4 py-3 text-[14px] text-white">{error}</p>}
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
      {localChains && (
        <DemoAccounts
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

/// Seeded logins for the local chains, one per role — click a row to fill the form (it does not sign in).
function DemoAccounts({ onPick }) {
  return (
    <details data-tour="login-demo" className="mt-8 rounded-[var(--radius-tile)] border border-hairline bg-paper">
      <summary className="cursor-pointer px-5 py-4 text-[14px] font-medium">Demo accounts (local chains only)</summary>
      <div className="border-t border-hairline px-2 py-2">
        <p className="px-3 pt-1 pb-2 text-[13px] text-ash">Public test credentials for the local demo chain — click one to fill the form. Never use them on a real network.</p>
        <ul className="flex flex-col">
          {DEMO_ACCOUNTS.map(([username, , kind, displayName, password, shows]) => (
            <li key={username}>
              <button type="button" onClick={() => onPick(username, password)} className="grid w-full grid-cols-[1fr_auto] gap-x-4 rounded-[12px] px-3 py-2 text-left hover:bg-white">
                <span className="text-[14px] font-medium">
                  {displayName} <span className="font-normal text-ash">· {kind}</span>
                </span>
                <span className="font-mono text-[13px] text-ash">
                  {username} / {password}
                </span>
                <span className="col-span-2 text-[13px] text-graphite">{shows}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}

export function AuthShell({ title, sub, children, wide = false }) {
  return (
    <div className={`mx-auto pt-14 ${wide ? "max-w-[880px]" : "max-w-[440px]"}`}>
      <h1 className="font-display text-[48px] leading-none font-normal tracking-tight">{title}</h1>
      <p className="mt-3 mb-8 text-[15px] text-ash">{sub}</p>
      {children}
    </div>
  );
}
