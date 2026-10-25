import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useApp } from "../lib/store";
import { api } from "../lib/api";
import { HOME, KIND_INFO } from "../lib/wallet";
import { Button, Field, Input } from "../components/ui/kit";
import { AuthShell } from "./Login";
import { discoverWallet } from "../lib/metamask";
import { short } from "../lib/chain";

const NAME_LABEL = { Donor: "Your name", NGO: "Organisation name", Vendor: "Business name", Field: "Organisation / your name", Watcher: "Display name" };

export default function Signup() {
  const { signup, signupWithMetaMask, loginWithMetaMask, toast } = useApp("signup", "signupWithMetaMask", "loginWithMetaMask", "toast");
  const navigate = useNavigate();
  const fromLogin = useLocation().state?.mm ?? null; // { signupToken, address } when sent here by "Continue with MetaMask"
  const [mode, setMode] = useState(fromLogin ? "metamask" : "password");
  const [mmSession, setMmSession] = useState(fromLogin);
  const [mmAvailable, setMmAvailable] = useState(undefined);
  useEffect(() => {
    discoverWallet().then(setMmAvailable);
  }, []);
  const [kind, setKind] = useState("Donor");
  const [form, setForm] = useState({ displayName: "", username: "", password: "", confirm: "" });
  const [step, setStep] = useState(null);
  const [error, setError] = useState(null);
  const put = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  /// MetaMask path, step 1: prove the wallet is yours (one signed message). An existing account just signs in.
  async function connectMetaMask() {
    setError(null);
    setStep("Waiting for MetaMask…");
    try {
      const out = await loginWithMetaMask();
      if (out.user) return navigate(HOME[out.user.kind], { replace: true });
      setMmSession({ signupToken: out.signupToken, address: out.address });
    } catch (err) {
      setError(err.shortMessage ?? err.message);
    } finally {
      setStep(null);
    }
  }

  async function submit(e) {
    e.preventDefault();
    setError(null);
    const metamask = mode === "metamask";
    if (metamask && !mmSession) return setError("Connect MetaMask first.");
    if (!metamask && form.password.length < 8) return setError("Password must be at least 8 characters.");
    if (!metamask && form.password !== form.confirm) return setError("Passwords don't match.");
    try {
      setStep(metamask ? "Creating your account…" : "Creating your wallet in this browser…");
      const user = metamask ? await signupWithMetaMask({ ...form, kind, signupToken: mmSession.signupToken }) : await signup({ ...form, kind });
      setStep("Funding your wallet on the test network…");
      try {
        const out = await api.post("/api/faucet");
        if (!out.already) toast({ title: "Wallet funded", body: "Test rupees and gas sent to your new wallet.", tone: "ok" });
      } catch {
        toast({ title: "Wallet not funded", body: "This network has no faucet — add funds to your wallet address to transact.", tone: "info", ms: 8000 });
      }
      navigate(HOME[user.kind], { replace: true });
    } catch (err) {
      setError(err.message);
      setStep(null);
    }
  }

  return (
    <AuthShell wide title="Create an account" sub="Pick what you do on GlassVault. Use your MetaMask wallet, or let us create one in this browser, encrypted with your password — the server never sees a key.">
      <form onSubmit={submit} className="flex flex-col gap-6">
        <div role="radiogroup" aria-label="Wallet" className="flex flex-wrap gap-2">
          {[
            ["password", "Password wallet"],
            ["metamask", "MetaMask"],
          ].map(([m, label]) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              onClick={() => (setMode(m), setError(null))}
              className={`h-10 rounded-full border px-5 text-[14px] font-medium ${mode === m ? "border-obsidian bg-obsidian text-white" : "border-hairline bg-white text-ash"}`}
            >
              {label}
            </button>
          ))}
        </div>
        {mode === "metamask" && (
          <div className="rounded-[var(--radius-tile)] border border-hairline bg-white p-5 text-[14px]">
            {mmSession ? (
              <span>
                MetaMask account <span className="font-mono">{short(mmSession.address, 6)}</span> verified — every transaction will ask MetaMask to confirm.
              </span>
            ) : (
              <div className="flex flex-wrap items-center gap-4">
                <Button type="button" variant="signal" disabled={!mmAvailable || !!step} onClick={connectMetaMask}>
                  {mmAvailable === null ? "Install MetaMask to use it" : "Connect MetaMask"}
                </Button>
                <span className="text-ash">Signs a one-time message to prove the wallet is yours — no fee.</span>
              </div>
            )}
          </div>
        )}
        <div role="radiogroup" aria-label="Account type" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Object.entries(KIND_INFO).map(([k, info]) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={kind === k}
              onClick={() => setKind(k)}
              className={`rounded-[var(--radius-tile)] border p-5 text-left transition-colors ${kind === k ? "border-obsidian bg-white" : "border-hairline bg-paper hover:border-ash/40"}`}
            >
              <div className="flex items-center justify-between">
                <span className="text-[16px] font-medium">{info.title}</span>
                <span className={`h-4 w-4 rounded-full border ${kind === k ? "border-[5px] border-obsidian" : "border-hairline bg-white"}`} />
              </div>
              <p className="mt-2 text-[14px] leading-snug text-ash">{info.text}</p>
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={NAME_LABEL[kind]} hint="Shown publicly next to your transactions.">
            <Input value={form.displayName} onChange={put("displayName")} maxLength={60} required />
          </Field>
          <Field label="Username" hint="3–32 characters: a–z, 0–9, . _ -">
            <Input autoComplete="username" value={form.username} onChange={put("username")} pattern="[a-zA-Z0-9_.\-]{3,32}" required />
          </Field>
          {mode === "password" && (
            <>
              <Field label="Password" hint="At least 8 characters. It also encrypts your wallet — it can't be reset.">
                <Input type="password" autoComplete="new-password" value={form.password} onChange={put("password")} required />
              </Field>
              <Field label="Confirm password">
                <Input type="password" autoComplete="new-password" value={form.confirm} onChange={put("confirm")} required />
              </Field>
            </>
          )}
        </div>

        {error && <p className="rounded-[var(--radius-input)] bg-obsidian px-4 py-3 text-[14px] text-white">{error}</p>}
        <div className="flex items-center gap-5">
          <Button type="submit" disabled={!!step}>
            {step ?? `Create ${kind === "NGO" ? "NGO" : KIND_INFO[kind].title.toLowerCase()} account`}
          </Button>
          <p className="text-[14px] text-ash">
            Have an account?{" "}
            <Link to="/login" className="font-medium text-obsidian underline underline-offset-4">
              Sign in
            </Link>
          </p>
        </div>
      </form>
    </AuthShell>
  );
}
