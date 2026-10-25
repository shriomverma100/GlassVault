// Shared e2e session helper: sign in as a seeded account and auto-answer the wallet unlock prompt.
// seeded local-chain accounts, one password each (backend/scripts/demo-accounts.js)
import { DEMO_PASSWORD } from "../backend/scripts/demo-accounts.js";

/// Signs the browser context in via the API (sets the session cookie). The wallet stays locked until
/// the first signature, when the app shows its unlock prompt — answered here automatically, so tests
/// exercise the same reload → unlock → continue path a real user hits.
export async function signIn(page, base, username) {
  const res = await page.request.post(`${base}/api/auth/login`, { data: { username, password: DEMO_PASSWORD[username] } });
  if (!res.ok()) throw new Error(`login ${username} failed: ${res.status()} ${await res.text()}`);
  await autoUnlock(page, DEMO_PASSWORD[username]);
}

export async function autoUnlock(page, password) {
  // Poll rather than addLocatorHandler: that only fires when an *action* is blocked, but the prompt
  // also appears while a test is merely waiting (e.g. for the navigation that follows a signature).
  const dialog = page.getByRole("dialog", { name: "Unlock your wallet to sign" });
  let busy = false;
  const timer = setInterval(async () => {
    if (busy || page.isClosed()) return;
    busy = true;
    try {
      if (await dialog.isVisible()) {
        await dialog.getByLabel("Password").fill(password);
        await dialog.getByRole("button", { name: "Unlock and continue" }).click();
        await dialog.waitFor({ state: "detached", timeout: 10_000 });
      }
    } catch {
      // page navigated or closed mid-check — try again next tick
    } finally {
      busy = false;
    }
  }, 250);
  page.on("close", () => clearInterval(timer));
}
