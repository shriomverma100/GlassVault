import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useApp } from "../lib/store";
import { HOME } from "../lib/wallet";
import { Button, Field, Input } from "../components/ui/kit";

export default function Login() {
  const { login } = useApp("login");
  const navigate = useNavigate();
  const from = useLocation().state?.from;
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

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
    <AuthShell title="Sign in" sub="Your wallet is unlocked in this browser with your password — it never leaves encrypted form.">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Username">
          <Input autoFocus autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required />
        </Field>
        <Field label="Password">
          <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        {error && <p className="rounded-[var(--radius-input)] bg-obsidian px-4 py-3 text-[14px] text-white">{error}</p>}
        <Button type="submit" disabled={busy}>
          {busy ? "Unlocking wallet…" : "Sign in"}
        </Button>
        <p className="text-[14px] text-ash">
          New here?{" "}
          <Link to="/signup" className="font-medium text-obsidian underline underline-offset-4">
            Create an account
          </Link>
        </p>
      </form>
    </AuthShell>
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
