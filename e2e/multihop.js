// The problem statement's multi-hop scenario through the UI: a donation paid in ETH on chain B is
// swapped, bridged and lands as a tagged lot; the seeded off-ramp payout shows the rupee payment hop;
// the escrow ledger has no unexplained money.
//   node e2e/multihop.js
import { chromium } from "playwright-core";
import { fileURLToPath } from "node:url";
import { signIn } from "./session.js";

const BASE = process.env.BASE || "http://localhost:5173";
const API = process.env.API || "http://localhost:4000";
const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const shot = (n) => fileURLToPath(new URL(`./shots/${n}.png`, import.meta.url));
const api = (p) => fetch(`${API}${p}`).then((r) => r.json());
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
  console.log(`  ✔ ${msg}`);
};

const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const errors = [];

// 1 — donate 0.1 ETH on chain B: swap + bridge in one transaction, relayed into a lot on chain A
let page = await ctx.newPage();
page.on("pageerror", (e) => errors.push(e.message));
await signIn(page, BASE, "priya");
await page.goto(`${BASE}/donate`, { waitUntil: "networkidle" });
const before = (await api("/api/state")).lots.length;
await page.getByText("Asha Foundation").first().click();
await page.getByRole("button", { name: "Water" }).click();
await page.getByRole("button", { name: /Chain B · via bridge/ }).click();
await page.getByRole("button", { name: /Pay in ETH · swapped/ }).click();
await page.getByLabel("Amount (ETH)").fill("0.1");
await page.getByText(/Swaps to about ₹20,000/).waitFor({ timeout: 15_000 });
await page.getByRole("button", { name: "Swap, bridge and donate" }).click();
await page.waitForURL(/\/passport\/\d+/, { timeout: 60_000 });
const lotId = Number(page.url().split("/").pop());
const lot = (await api("/api/state")).lots[lotId];
assert(lotId >= before, `ETH donation landed as lot #${lotId}`);
assert(lot.origin?.asset === "ETH" && Math.abs(lot.origin.ethIn - 0.1) < 1e-9, "lot remembers the original asset: 0.1 ETH");
assert(lot.amount === 20_000 && lot.category === "Water", "swapped to ₹20,000 at the DEX, purpose tag kept across swap + bridge");
assert(lot.origin.swapTx && lot.origin.deliverTx, "swap, bridge and delivery hops reconstructed from events alone");
await page.getByText(/Swapped to ₹20,000 at the exchange/).waitFor({ timeout: 15_000 });
await page.screenshot({ path: shot("multihop-passport-new"), fullPage: true });
await page.close();

// 2 — the seeded off-ramp payout: ETH → swap → bridge → lot → agent → rupees paid → delivered
const state = await api("/api/state");
const fiatPayout = state.payouts.find((p) => p.offRamp && p.fiat);
assert(fiatPayout && fiatPayout.status === "Completed", `off-ramp payout #${fiatPayout?.id} completed only after rupee payment + delivery proof`);
const seededLot = fiatPayout.shares[0].lotId;
page = await ctx.newPage();
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(`${BASE}/passport/${seededLot}`, { waitUntil: "networkidle" });
for (const hop of [/Donated 0\.25 ETH on chain/, /Swapped to ₹50,000 at the exchange/, /Bridged to chain/, /Invoice signed by PayLink/, /in rupees to a local vendor/, /Impact verified/]) {
  await page.getByText(hop).first().waitFor({ timeout: 15_000 });
}
assert(true, "Passport shows every hop: ETH → swap → bridge → lot → agent invoice → rupees paid → impact");
await page.screenshot({ path: shot("multihop-passport-seeded"), fullPage: true });

// 3 — no unexplained money in escrow
await page.goto(`${BASE}/watchtower`, { waitUntil: "networkidle" });
await page.getByText("Every rupee in escrow is accounted for.").waitFor({ timeout: 15_000 });
assert((await api("/api/state")).stats.ledger.gap === 0, "escrow ledger gap = ₹0");

await browser.close();
if (errors.length) {
  console.log("runtime errors:\n  " + errors.join("\n  "));
  process.exit(1);
}
console.log("✔ multi-hop journey passed");
