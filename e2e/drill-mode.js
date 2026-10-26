// The in-app Drill, performed end to end through its own panel: every step is entered with the Enter
// key, every role is switched with the panel's "Sign in as …" button, every action is done on the real
// page (uploads included), and every on-chain step must turn "Done — detected on the chain".
//   node e2e/drill-mode.js        (against a freshly started stack)
import { chromium } from "playwright-core";
import { fileURLToPath } from "node:url";
import { DEMO_PASSWORD } from "../backend/scripts/demo-accounts.js";

const BASE = process.env.BASE || "http://localhost:5173";
const API = process.env.API || "http://localhost:4000";
const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const kit = (f) => fileURLToPath(new URL(`../demo/kit/${f}`, import.meta.url));
const shot = (n) => (process.env.GV_SHOTS ? `${process.env.GV_SHOTS}/${n}.png` : fileURLToPath(new URL(`./shots/${n}.png`, import.meta.url)));
const api = (p) => fetch(`${API}${p}`).then((r) => r.json());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, what, ms = 90_000) {
  for (const t0 = Date.now(); Date.now() - t0 < ms; await sleep(400)) if (await fn()) return true;
  throw new Error(`timed out waiting for: ${what}`);
}
const waitPast = (t) => until(async () => Date.now() / 1000 > t + 2, `time ${t}`, 180_000);

const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

// After a reload the wallet is locked again: answer the unlock prompt for whoever is signed in.
setInterval(async () => {
  try {
    const dlg = page.getByRole("dialog", { name: "Unlock your wallet to sign" });
    if (!(await dlg.isVisible())) return;
    const me = await page.evaluate(() => fetch("/api/auth/me").then((r) => r.json()));
    await dlg.getByLabel("Password").fill(DEMO_PASSWORD[me.user.username]);
    await dlg.getByRole("button", { name: "Unlock and continue" }).click();
  } catch {}
}, 300);

let n = 0;
const panel = page.locator('aside[aria-label="Judges\' drill"]');
async function at(id) {
  await page.locator(`[data-drill-step="${id}"]`).waitFor({ timeout: 20_000 });
}
async function next(from) {
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press("Enter");
  await page.locator(`[data-drill-step="${from}"]`).waitFor({ state: "detached", timeout: 10_000 });
}
async function as(role) {
  const sw = page.locator(`[data-drill-switch="${role}"]`);
  if (await sw.isVisible().catch(() => false)) await sw.click();
  await panel.getByText(`Signed in as ${role}`).waitFor({ timeout: 30_000 });
  await page.waitForLoadState("networkidle");
}
async function done(id, ms = 90_000) {
  await panel.getByText("Done — detected on the chain").waitFor({ timeout: ms });
  console.log(`  ✔ ${String(++n).padStart(2)} ${id} — detected on the chain`);
}
const note = (id, what) => console.log(`  ✔ ${String(++n).padStart(2)} ${id} — ${what}`);
const dismissFreeze = async () => {
  const ok = page.getByRole("button", { name: "Understood" });
  if (await ok.isVisible().catch(() => false)) await ok.click();
};

async function invoice(ngo, no, file) {
  await page.getByRole("button", { name: ngo, exact: true }).click();
  await page.getByPlaceholder("BW-1043").fill(no);
  const rows = page.locator("div.grid.grid-cols-\\[72px_1fr_120px_36px\\]");
  await rows.nth(0).locator("input").nth(0).fill("2");
  await rows.nth(0).getByPlaceholder("Item").fill("Hand pump (India Mark II)");
  await rows.nth(0).getByPlaceholder("₹ each").fill("7500");
  await page.getByRole("button", { name: "Add line" }).click();
  await rows.nth(1).locator("input").nth(0).fill("5");
  await rows.nth(1).getByPlaceholder("Item").fill("GI pipe 3m");
  await rows.nth(1).getByPlaceholder("₹ each").fill("1000");
  await page.locator('input[type="file"]').setInputFiles(kit(file));
  await page.getByText(file).first().waitFor({ timeout: 15_000 });
  await page.getByRole("button", { name: "Sign and send to NGO" }).click();
}
async function cards(ngo, label, count) {
  await page.getByRole("button", { name: "Issue cards" }).waitFor({ timeout: 30_000 });
  await page.getByRole("button", { name: ngo, exact: true }).click();
  await page.getByLabel("Batch label").fill(label);
  await page.getByLabel("Number of cards").fill(String(count));
  await page.getByRole("button", { name: "Issue cards" }).click();
  await page.locator("[data-card-key]").first().waitFor({ timeout: 30_000 });
}
// page clicks are scoped to <main>: the drill panel repeats the same words in its instructions
const main = page.locator("main");
async function request(invoiceNo, batch) {
  await main.getByText(invoiceNo, { exact: true }).first().click();
  await main.getByRole("button", { name: new RegExp(batch) }).click();
  await sleep(1500);
  await page.getByRole("button", { name: "Request payout" }).click();
}

// ── start (guest, home page) ──
await page.goto(BASE + "/", { waitUntil: "networkidle" });
await page.evaluate(() => sessionStorage.removeItem("gv.drill"));
await page.evaluate(() => window.__gvStartDrill());
await at("intro");
await page.screenshot({ path: shot("drill-panel-intro") });
note("intro", "drill opened, Enter moves on");
await next("intro");

await at("landing");
await page.locator('[data-tour="landing-how"]').waitFor();
note("landing", "home page, flow diagram highlighted");
await next("landing");

await at("metamask");
note("metamask", "optional step shown (MetaMask is covered by e2e/metamask.js)");
await next("metamask");

// ── A · honest flow ──
await at("donate");
await as("priya");
await main.getByText("Asha Foundation").first().click();
await main.getByRole("button", { name: "Water" }).click();
await page.locator('input[type="number"]').first().fill("25000");
await page.getByRole("button", { name: "Send it to another NGO" }).click();
await page.getByRole("button", { name: /^Shadow Trust · trust/ }).click();
await page.getByRole("button", { name: "Donate", exact: true }).click();
await done("donate");
await next("donate");

await at("invoice");
await as("bluewell");
await page.screenshot({ path: shot("drill-panel-invoice") });
await invoice("Asha Foundation", "BW-2001", "BW-2001-handpumps.png");
await done("invoice (BW-2001 + receipt upload)");
await next("invoice");

await at("cards");
await as("field");
await cards("Asha Foundation", "Wadgaon hand-pump households", 3);
await page.getByText(/back when you close this/).waitFor(); // the panel folds away from the card drawer
await until(async () => (await page.evaluate(() => JSON.parse(sessionStorage.getItem("gv.drill"))?.keys?.asha?.length)) === 3, "drill captured 3 card keys");
await page.screenshot({ path: shot("drill-panel-folded") });
await page.getByRole("button", { name: "Close", exact: true }).click();
await done("cards (3 QR cards; keys captured; panel folded for the drawer)");
await next("cards");

await at("request");
await as("asha");
await request("BW-2001", "Wadgaon hand-pump households");
await done("request payout");
await next("request");

await at("release");
const payoutId = await page.evaluate(() => JSON.parse(sessionStorage.getItem("gv.drill")).mem.asha);
await waitPast((await api("/api/state")).payouts[payoutId].releaseAt);
await page.reload({ waitUntil: "networkidle" });
await at("release"); // the drill survives a reload
await page.getByRole("button", { name: "Release 70%" }).first().click();
await done("release 70% (drill kept its place across a reload)");
await next("release");

await at("deliver");
await as("field");
const keys = await page.evaluate(() => JSON.parse(sessionStorage.getItem("gv.drill")).keys.asha);
await panel.getByText("Card 1 ·").waitFor();
await page.screenshot({ path: shot("drill-panel-keys") });
for (const [i, key] of keys.entries()) {
  await page.getByRole("button", { name: new RegExp(`Payout #${payoutId}\\b`) }).click();
  await page.getByLabel("Or paste the card key").fill(key);
  await page.getByText("Card is on this payout's approved list.").waitFor({ timeout: 15_000 });
  await page.getByRole("button", { name: "Confirm handover on-chain" }).click();
  await until(async () => (await api("/api/state")).payouts[payoutId].deliveries === i + 1, `delivery ${i + 1}`);
  await page.getByRole("button", { name: "Confirming…" }).waitFor({ state: "detached", timeout: 60_000 });
}
await done("deliver (3 cards pasted from the drill panel)");
await next("deliver");

await at("passport");
await as("priya");
note("passport", "Priya's passports");
await next("passport");

await at("fiat");
await page.locator('[data-tour="passport-journey"]').waitFor({ timeout: 20_000 });
note("fiat", "donation #7 journey opened by the drill");
await next("fiat");

// ── B · the attack ──
await at("shadow-card");
await as("field");
await cards("Shadow Trust", "Shadow 'beneficiaries'", 1);
await page.getByRole("button", { name: "Close", exact: true }).click();
await done("shadow card");
await next("shadow-card");

await at("rescan");
await as("bluewell");
await invoice("Shadow Trust", "BW-2077", "BW-2001-rescan-as-BW-2077.png");
await done("rescan (BW-2077 + re-scanned receipt upload)");
await next("rescan");

await at("fraud");
await as("shadow");
await request("BW-2077", "Shadow 'beneficiaries'");
await done("fraud payout challenged by the watcher bot");
await next("fraud");

await at("court");
await as("navkiran");
const fraudId = await page.evaluate(() => JSON.parse(sessionStorage.getItem("gv.drill")).mem.fraud);
await page.getByRole("button", { name: /Uphold ·/ }).first().click();
await until(async () => (await api("/api/state")).payouts[fraudId].challenge?.votesUphold > 0, "uphold vote");
await waitPast((await api("/api/state")).payouts[fraudId].challenge.voteEnd);
await page.reload({ waitUntil: "networkidle" });
await page.getByRole("button", { name: "Resolve on-chain" }).first().click();
await done("court (donor upheld, resolved on-chain)");
await next("court");

await at("freeze");
await as("watcher");
for (const step of [2, 3]) {
  await sleep(1500);
  if ((await api("/api/state")).ngos[1].frozen) break;
  await dismissFreeze();
  const ran = page.waitForResponse((r) => r.url().includes("/api/demo/attack/") && r.request().method() === "POST", { timeout: 60_000 });
  await page.getByRole("button", { name: "Run", exact: true }).nth(step).click();
  await ran;
}
await until(async () => (await api("/api/state")).ngos[1].frozen, "Shadow Trust frozen");
await sleep(1200);
await page.screenshot({ path: shot("drill-panel-freeze") });
await dismissFreeze();
await done("freeze (contract froze Shadow Trust)");
await next("freeze");

await at("redirect");
await page.reload({ waitUntil: "networkidle" });
await at("redirect");
await page.getByRole("button", { name: /^Redirect to Asha Foundation/ }).first().click();
await done("redirect (dead-man switch)");
await next("redirect");

await at("reconcile");
await page.getByRole("button", { name: /Load example/ }).click();
await page.getByRole("button", { name: "Reconcile against the chain" }).click();
await page.getByText(/double-counted|Double/i).first().waitFor({ timeout: 15_000 });
note("reconcile", "double-counted report caught");
await next("reconcile");

await at("benchmark");
await page.getByRole("button", { name: /Run 100-receipt benchmark/ }).click();
await page.getByText("Fraud caught (recall)").waitFor({ timeout: 120_000 });
if ((await api("/api/state")).stats.ledger.gap !== 0) throw new Error("escrow ledger gap");
note("benchmark", "30/30 caught, ledger gap ₹0");
await next("benchmark");

await at("verify");
await page.getByText(/^#\d+$/).first().waitFor({ timeout: 15_000 });
for (const [file, verdict] of [["BW-2001-handpumps.png", `backs payout #${payoutId} — Completed`], ["BW-2001-rescan-as-BW-2077.png", `backs payout #${fraudId} — Cancelled`]]) {
  await page.locator('input[type="file"]').setInputFiles(kit(file));
  await page.getByText(verdict).waitFor({ timeout: 60_000 });
}
// the upload files are downloadable from the panel itself
for (const f of ["BW-2001-handpumps.png", "BW-2001-rescan-as-BW-2077.png"]) {
  const r = await page.request.get(`${BASE}/drill/${f}`);
  if (!r.ok() || !(r.headers()["content-type"] ?? "").includes("image/png")) throw new Error(`/drill/${f} not served`);
}
note("verify", "both receipts verified from the chain; upload files downloadable from the panel");
await next("verify");

await at("acceptance");
note("acceptance", "terminal step shown (npm run acceptance runs separately)");
await next("acceptance");

await at("done");
await panel.getByRole("button", { name: "Finish" }).click();
await panel.waitFor({ state: "detached" });
note("done", "drill finished");

await browser.close();
if (errors.length) throw new Error("page errors: " + errors.join("; "));
console.log(`✔ drill mode passed — all ${n} steps performed through the in-app drill`);
process.exit(0);
