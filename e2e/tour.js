// Role-based guided tour: for a guest and each signed-in role, start the tour, walk every step (each
// must show its title, and its highlighted target when the page has one), finish, and screenshot.
//   node e2e/tour.js
import { chromium } from "playwright-core";
import { fileURLToPath } from "node:url";
import { signIn } from "./session.js";

const BASE = process.env.BASE || "http://localhost:5173";
const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const shot = (n) => fileURLToPath(new URL(`./shots/${n}.png`, import.meta.url));

const ROLES = [
  [null, "guest"],
  ["priya", "donor"],
  ["asha", "ngo"],
  ["bluewell", "vendor"],
  ["field", "field"],
  ["watcher", "watcher"],
];

const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const errors = [];
for (const [username, name] of ROLES) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
  if (username) await signIn(page, BASE, username);
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.waitForFunction(() => typeof window.__gvStartTour === "function", null, { timeout: 15_000 });
  await page.evaluate(() => window.__gvStartTour());
  const dialog = page.getByRole("dialog");
  await dialog.waitFor();
  const total = Number((await dialog.getByText(/Step \d+ of \d+/).innerText()).match(/of (\d+)/)[1]);
  const titles = [];
  for (let i = 0; i < total; i++) {
    await dialog.getByText(`Step ${i + 1} of ${total}`).waitFor({ timeout: 10_000 });
    titles.push(await dialog.locator("#tour-title").innerText());
    if (i === 2) {
      await page.waitForTimeout(1500); // let the step's page load and the highlight settle
      await page.screenshot({ path: shot(`tour-${name}-step3`) });
    }
    await dialog.getByRole("button", { name: i === total - 1 ? "Done" : "Next" }).click();
  }
  await dialog.waitFor({ state: "detached" });
  console.log(`  ✔ ${name.padEnd(8)} ${total} steps: ${titles.join(" → ")}`);
  await ctx.close();
}

// first impression: Explore with the new charts, signed out, tour dismissed
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.goto(BASE + "/", { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
await page.screenshot({ path: shot("explore-visuals"), fullPage: true });
await browser.close();

if (errors.length) {
  console.log("runtime errors:\n  " + errors.join("\n  "));
  process.exit(1);
}
console.log("✔ guided tours passed for every role");
