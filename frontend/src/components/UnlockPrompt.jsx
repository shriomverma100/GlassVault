import { useState } from "react";
import { useApp } from "../lib/store";
import { short } from "../lib/chain";
import { Button, Field, Input } from "./ui/kit";

/// Shown when an action needs a signature but the wallet is locked (e.g. after a page reload).
/// Unlocking continues the action that asked for it.
export default function UnlockPrompt() {
  const { unlockRequest, user } = useApp("unlockRequest", "user");
  if (!unlockRequest || !user) return null;
  return <Prompt user={user} />;
}

function Prompt({ user }) {
  const { unlock, cancelUnlock } = useApp("unlock", "cancelUnlock");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await unlock(password);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div data-overlay="unlock" className="page-enter fixed inset-0 z-[80] grid place-items-center bg-obsidian/40" role="dialog" aria-modal="true" aria-labelledby="unlock-title">
      <form onSubmit={submit} onKeyDown={(e) => e.key === "Escape" && cancelUnlock()} className="w-[420px] max-w-[92vw] rounded-[var(--radius-card)] border border-hairline bg-paper p-8">
        <h2 id="unlock-title" className="font-display text-[28px] leading-tight font-normal">
          Unlock your wallet to sign
        </h2>
        <p className="mt-2 mb-6 text-[14px] text-ash">
          {user.displayName} · <span className="font-mono">{short(user.address, 4)}</span>
        </p>
        <Field label="Password">
          <Input type="password" autoFocus autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        {error && <p className="mt-3 text-[14px] font-medium text-obsidian">{error}</p>}
        <div className="mt-6 flex gap-3">
          <Button type="submit" disabled={busy} className="flex-1">
            {busy ? "Unlocking…" : "Unlock and continue"}
          </Button>
          <Button type="button" variant="ghost" onClick={cancelUnlock}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
