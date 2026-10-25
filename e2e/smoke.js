// Headless smoke test: opens every page as the role that uses it, fails on any runtime error,
// and saves screenshots to e2e/shots/.   node e2e/smoke.js
import { chromium } from "playwright-core";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const BASE = process.env.BASE || "http://localhost:5173";
const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
fs.mkdirSync(new URL("./shots/", import.meta.url), { recursive: true });

const pages = [
  ["/", "donorPriya", "explore"],
  ["/donate", "donorPriya", "donate"],
  ["/passport", "donorPriya", "passport-list"],
  ["/passport/0", "donorPriya", "passport-0"],
  ["/ngo", "ngoAsha", "ngo"],
  ["/vendor", "vendorWater", "vendor"],
  ["/field", "fieldWorker", "field"],
  ["/watchtower", "watcher", "watchtower"],
];

const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
let failures = 0;

for (const [path, role, name] of pages) {
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text()}`));
  await page.addInitScript((r) => localStorage.setItem("gv-role", r), role);
  await page.goto(BASE + path, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500); // let animations + live state settle
  await page.screenshot({ path: fileURLToPath(new URL(`./shots/${name}.png`, import.meta.url)), fullPage: true });
  const ok = errors.length === 0;
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"} ${path.padEnd(14)} as ${role}${ok ? "" : "\n     " + errors.slice(0, 4).join("\n     ")}`);
  await page.close();
}

await browser.close();
process.exit(failures ? 1 : 0);
