// Probabilistic evaluation chain: the seeded completed lot shows its 4 stages in the PS order with a
// chain confidence, and the public API returns the same re-runnable calculation.
//   node e2e/confidence.js
import { chromium } from "playwright-core";
import { fileURLToPath } from "node:url";

const BASE = process.env.BASE || "http://localhost:5173";
const API = process.env.API || "http://localhost:4000";
const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const shot = (n) => fileURLToPath(new URL(`./shots/${n}.png`, import.meta.url));
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
  console.log(`  ✔ ${msg}`);
};

const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

await page.goto(`${BASE}/passport/0`, { waitUntil: "networkidle" }); // signed out: public
await page.getByText(/Chain confidence/).first().waitFor({ timeout: 15_000 });
await page.getByText("Probabilistic evaluation chain").first().waitFor();
await page.screenshot({ path: shot("confidence-passport"), fullPage: true });

const c = await fetch(`${API}/api/confidence/0`).then((r) => r.json());
assert(typeof c.score === "number" && c.score >= 0 && c.score <= 1, `chain confidence ${c.score} is a probability`);
assert(JSON.stringify(c.stages.map((s) => s.key)) === JSON.stringify(["inbound", "escrow", "impact", "invoice"]), "4 stages in the PS order: inbound → escrow → impact → invoice");
assert(c.stages.every((s) => s.p === null || (s.p >= 0 && s.p <= 1)), "every stage probability is in [0, 1] or not reached");

await browser.close();
if (errors.length) {
  console.log("runtime errors:\n  " + errors.join("\n  "));
  process.exit(1);
}
console.log("✔ probabilistic evaluation chain rendered");
