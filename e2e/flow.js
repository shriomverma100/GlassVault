// End-to-end through the real UI (real signed transactions on the local chain):
//   1. Priya donates ₹5,000 for Water to Asha Foundation → lands on her new passport
//   2. An independent field partner issues 5 beneficiary cards for Asha and attests the list on-chain
//   3. Asha Foundation opens vendor-signed invoice MC-311, picks that attested list, passes all live
//      pre-checks and requests the payout → payout appears on-chain
//   4. The field partner confirms one handover by scanning (pasting) a printed card key → the card
//      signs the delivery; the key never goes on-chain
//   node e2e/flow.js
import { chromium } from "playwright-core";
import { signIn } from "./session.js";
import { fileURLToPath } from "node:url";

const BASE = process.env.BASE || "http://localhost:5173";
const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const shot = (n) => fileURLToPath(new URL(`./shots/${n}.png`, import.meta.url));
const api = (p) => fetch(`${process.env.API || "http://localhost:4000"}${p}`).then((r) => r.json());
const until = async (page, fn, msg, tries = 60) => {
  for (let i = 0; i < tries; i++) {
    const v = await fn();
    if (v) return v;
    await page.waitForTimeout(500);
  }
  throw new Error(`timed out: ${msg}`);
};

const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const errors = [];
const open = async (username, path) => {
  await ctx.clearCookies();
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await signIn(page, BASE, username);
  await page.goto(BASE + path, { waitUntil: "networkidle" });
  return page;
};
const step = (msg) => console.log(`  · ${msg}`);

// 1 — donate
const before = (await api("/api/state")).lots.length;
let page = await open("priya", "/donate");
await page.getByText("Asha Foundation").first().click();
await page.getByRole("button", { name: "Water" }).click();
await page.locator('input[type="number"]').first().fill("5000");
// dead-man switch: if Asha is frozen or misses the deadline, unspent funds go to Shadow Trust
await page.getByRole("button", { name: "Send it to another NGO" }).click();
await page.getByRole("button", { name: /^Shadow Trust · trust/ }).click();
await page.getByRole("button", { name: "Donate", exact: true }).click();
await page.waitForURL(/\/passport\/\d+/, { timeout: 30_000 });
const lotId = Number(page.url().split("/").pop());
await page.waitForTimeout(2000);
await page.screenshot({ path: shot("flow-1-passport"), fullPage: true });
const lot = (await api("/api/state")).lots[lotId];
step(`donated → passport #${lotId} · on-chain lot: ₹${lot.amount} ${lot.category} (lots ${before} → ${lotId + 1})`);
if (lot.amount !== 5000 || lot.category !== "Water") throw new Error("lot mismatch");
if (lot.fallbackNgoId !== 1) throw new Error(`fallback not recorded on-chain (fallbackNgoId=${lot.fallbackNgoId})`);
step("fallback NGO recorded on-chain: Shadow Trust");
await page.close();

// 2 — field partner issues and attests 5 cards for Asha Foundation (the NGO can't issue its own)
const batchesBefore = ((await api("/api/state")).batches ?? []).length;
page = await open("field", "/field");
const register = page.getByRole("button", { name: "Stake and register" });
if (await register.isVisible().catch(() => false)) {
  await register.click();
  step("field partner staked ₹2,000 and registered");
}
await page.getByRole("button", { name: "Issue cards" }).waitFor({ timeout: 30_000 });
await page.getByRole("button", { name: "Asha Foundation", exact: true }).click();
await page.getByLabel("Batch label").fill("MC-311 e2e households");
await page.getByLabel("Number of cards").fill("5");
await page.getByRole("button", { name: "Issue cards" }).click();
const cardKey = (await page.locator("[data-card-key]").first().textContent({ timeout: 30_000 })).trim(); // printed card #1
await page.screenshot({ path: shot("flow-2-cards"), fullPage: true });
await page.getByRole("button", { name: "Close", exact: true }).click(); // printable QR cards panel
const batch = await until(page, async () => ((await api("/api/state")).batches ?? []).slice(batchesBefore).find((b) => b.cards === 5), "batch attested on-chain");
step(`field partner attested 5 cards for Asha on-chain · list ${batch.root.slice(0, 10)}… (keys printed, never sent)`);
await page.close();

// 3 — NGO submits MC-311 against the attested list
const payoutsBefore = (await api("/api/state")).payouts.length;
page = await open("asha", "/ngo");
await page.getByText("MC-311", { exact: true }).first().click(); // the invoice card, not the next-action chip
await page.getByRole("button", { name: /MC-311 e2e households/ }).click();
await page.waitForTimeout(1500); // live pre-checks (on-chain nullifier lookup)
await page.screenshot({ path: shot("flow-3-prepare"), fullPage: true });
await page.getByRole("button", { name: "Request payout" }).click();
await until(page, async () => (await api("/api/state")).payouts.length > payoutsBefore, "payout requested");
const p = (await api("/api/state")).payouts.at(-1);
step(`NGO requested payout #${p.id} · ₹${p.amount} ${p.category} → ${p.status} · ${p.deliveriesRequired} deliveries required`);
if (p.amount !== 50000 || p.status !== "Pending" || p.beneficiaryRoot.toLowerCase() !== batch.root.toLowerCase()) throw new Error("payout mismatch");
await page.screenshot({ path: shot("flow-4-ngo-after"), fullPage: true });
await page.close();

// 4 — field partner confirms one handover with a printed card key
page = await open("field", "/field");
await page.getByRole("button", { name: new RegExp(`Payout #${p.id}\\b`) }).click();
await page.getByLabel("Or paste the card key").fill(cardKey);
await page.getByText("Card is on this payout's approved list.").waitFor({ timeout: 15_000 });
await page.getByRole("button", { name: "Confirm handover on-chain" }).click();
await until(page, async () => (await api("/api/state")).payouts[p.id].deliveries === 1, "delivery confirmed");
step(`card #1 signed the delivery of payout #${p.id} → 1/${p.deliveriesRequired} confirmed (card key never on-chain)`);
await page.screenshot({ path: shot("flow-5-delivery"), fullPage: true });

await browser.close();
if (errors.length) {
  console.log("runtime errors:\n  " + errors.join("\n  "));
  process.exit(1);
}
console.log("✔ UI flow passed with real transactions");
