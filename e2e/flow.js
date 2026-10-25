// End-to-end through the real UI (real signed transactions on the local chain):
//   1. Priya donates ₹5,000 for Water to Asha Foundation → lands on her new passport
//   2. Asha Foundation opens vendor-signed invoice MC-311, attaches a beneficiary batch,
//      passes all live pre-checks and requests the payout → payout appears on-chain
//   node e2e/flow.js
import { chromium } from "playwright-core";
import { fileURLToPath } from "node:url";

const BASE = process.env.BASE || "http://localhost:5173";
const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const shot = (n) => fileURLToPath(new URL(`./shots/${n}.png`, import.meta.url));
const api = (p) => fetch(`${process.env.API || "http://localhost:4000"}${p}`).then((r) => r.json());

const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const errors = [];
const open = async (role, path) => {
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript((r) => localStorage.setItem("gv-role", r), role);
  await page.goto(BASE + path, { waitUntil: "networkidle" });
  return page;
};
const step = (msg) => console.log(`  · ${msg}`);

// 1 — donate
const before = (await api("/api/state")).lots.length;
let page = await open("donorPriya", "/donate");
await page.getByText("Asha Foundation").first().click();
await page.getByRole("button", { name: "Water" }).click();
await page.locator('input[type="number"]').first().fill("5000");
await page.getByRole("button", { name: "Donate", exact: true }).click();
await page.waitForURL(/\/passport\/\d+/, { timeout: 30_000 });
const lotId = Number(page.url().split("/").pop());
await page.waitForTimeout(2000);
await page.screenshot({ path: shot("flow-1-passport"), fullPage: true });
const lot = (await api("/api/state")).lots[lotId];
step(`donated → passport #${lotId} · on-chain lot: ₹${lot.amount} ${lot.category} (lots ${before} → ${lotId + 1})`);
if (lot.amount !== 5000 || lot.category !== "Water") throw new Error("lot mismatch");
await page.close();

// 2 — NGO submits MC-311
const payoutsBefore = (await api("/api/state")).payouts.length;
page = await open("ngoAsha", "/ngo");
await page.getByText("MC-311").first().click();
await page.getByText("PHC Kamptee diabetic patients").first().click();
await page.waitForTimeout(1500); // live pre-checks (on-chain nullifier lookup)
await page.screenshot({ path: shot("flow-2-prepare"), fullPage: true });
await page.getByRole("button", { name: "Request payout" }).click();
for (let i = 0; i < 30 && (await api("/api/state")).payouts.length === payoutsBefore; i++) await page.waitForTimeout(500);
const p = (await api("/api/state")).payouts.at(-1);
step(`NGO requested payout #${p.id} · ₹${p.amount} ${p.category} → ${p.status} · ${p.deliveriesRequired} deliveries required`);
if (p.amount !== 50000 || p.status !== "Pending") throw new Error("payout mismatch");
await page.waitForTimeout(1500);
await page.screenshot({ path: shot("flow-3-ngo-after"), fullPage: true });

await browser.close();
if (errors.length) {
  console.log("runtime errors:\n  " + errors.join("\n  "));
  process.exit(1);
}
console.log("✔ UI flow passed with real transactions");
