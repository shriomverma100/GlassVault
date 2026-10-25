import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useApp } from "../lib/store";
import { api } from "../lib/api";
import { HOME, KIND_INFO } from "../lib/wallet";
import { Button, Field, Input } from "../components/ui/kit";
import { AuthShell } from "./Login";

const NAME_LABEL = { Donor: "Your name", NGO: "Organisation name", Vendor: "Business name", Field: "Organisation / your name", Watcher: "Display name" };

export default function Signup() {
  const { signup, toast } = useApp("signup", "toast");
  const navigate = useNavigate();
  const [kind, setKind] = useState("Donor");
  const [form, setForm] = useState({ displayName: "", username: "", password: "", confirm: "" });
  const [step, setStep] = useState(null);
  const [error, setError] = useState(null);
  const put = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setError(null);
    if (form.password.length < 8) return setError("Password must be at least 8 characters.");
    if (form.password !== form.confirm) return setError("Passwords don't match.");
    try {
      setStep("Creating your wallet in this browser…");
      const user = await signup({ ...form, kind });
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
    <AuthShell wide title="Create an account" sub="Pick what you do on GlassVault. A wallet is created for you and encrypted with your password — the server never sees its key.">
      <form onSubmit={submit} className="flex flex-col gap-6">
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
          <Field label="Password" hint="At least 8 characters. It also encrypts your wallet — it can't be reset.">
            <Input type="password" autoComplete="new-password" value={form.password} onChange={put("password")} required />
          </Field>
          <Field label="Confirm password">
            <Input type="password" autoComplete="new-password" value={form.confirm} onChange={put("confirm")} required />
          </Field>
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
