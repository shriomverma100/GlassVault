// Red team through the real UI (Watchtower → Red team panel), on a freshly seeded chain:
//   shell vendor → doctored photo (watcher must challenge) → duplicate (flag 1) → forged (flag 2 → FREEZE)
//   → donors' verdict (challenge upheld, stakes slashed) → 100-receipt benchmark card.
//   node e2e/attack.js
import { chromium } from "playwright-core";
import { fileURLToPath } from "node:url";

const BASE = process.env.BASE || "http://localhost:5173";
const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const shot = (n) => fileURLToPath(new URL(`./shots/${n}.png`, import.meta.url));
const api = (p) => fetch(`${process.env.API || "http://localhost:4000"}${p}`).then((r) => r.json());
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
  console.log(`  ✔ ${msg}`);
};

const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.addInitScript(() => localStorage.setItem("gv-role", "watcher"));
await page.goto(`${BASE}/watchtower`, { waitUntil: "networkidle" });

const shadow = () => api("/api/state").then((s) => s.ngos[1]);
assert(!(await shadow()).frozen, "Shadow Trust starts active");

const runStep = async (i, name) => {
  const done = page.waitForResponse((r) => r.url().includes("/api/demo/attack/") && r.request().method() === "POST", { timeout: 60_000 });
  await page.getByRole("button", { name: "Run", exact: true }).nth(i).click();
  const res = await done;
  const body = await res.json();
  console.log(`  · step ${i + 1} ${name}: ${body.note ?? body.error}`);
  await page.waitForTimeout(1500);
};

await runStep(0, "shell vendor");
await runStep(1, "doctored photo");
// the watcher bot must catch the doctored photo on its own
let challenged = null;
for (let i = 0; i < 20 && !challenged; i++) {
  challenged = (await api("/api/state")).payouts.find((p) => p.ngoId === 1 && p.status === "Challenged");
  if (!challenged) await page.waitForTimeout(500);
}
assert(challenged, `watcher bot challenged the doctored payout #${challenged?.id} by itself`);

await runStep(2, "duplicate");
assert((await shadow()).flagCount === 1, "duplicate invoice → fraud flag 1 (nullifier collision)");

await runStep(3, "forged signature");
assert((await shadow()).frozen, "forged signature → flag 2 → NGO auto-frozen by the contract");
await page.getByText("Escrow frozen by contract").waitFor({ timeout: 10_000 });
await page.waitForTimeout(1800);
await page.screenshot({ path: shot("attack-freeze-frame") });
assert(true, "Freeze Frame appeared live in the UI");
await page.getByRole("button", { name: "Understood" }).click();

await runStep(4, "donors' verdict");
const p = (await api("/api/state")).payouts.find((x) => x.id === challenged.id);
assert(p.status === "Cancelled" && p.challenge.upheld, "donors upheld the challenge → payout cancelled, funds back to lots");
const shell = (await api("/api/state")).vendors.find((v) => !v.registered);
assert(shell && shell.stake === 0, "shell vendor's stake slashed and de-registered");

// benchmark from the UI
const started = Date.now();
await page.getByRole("button", { name: /Run 100-receipt benchmark/ }).click();
await page.getByText("Fraud caught (recall)").waitFor({ timeout: 120_000 });
await page.waitForTimeout(1500);
await page.getByText("Fraud caught (recall)").scrollIntoViewIfNeeded();
await page.screenshot({ path: shot("attack-benchmark") });
assert(true, `benchmark card rendered (${Math.round((Date.now() - started) / 1000)}s)`);
await page.screenshot({ path: shot("attack-watchtower-full"), fullPage: true });

await browser.close();
if (errors.length) {
  console.log("runtime errors:\n  " + errors.join("\n  "));
  process.exit(1);
}
console.log("✔ red-team flow passed through the UI");
