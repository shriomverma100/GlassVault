// New-account journey through the UI: sign up as an NGO (wallet created + encrypted in the browser),
// get funded by the local faucet, post the bond and register on-chain, reload, sign out, sign back in.
//   node e2e/signup.js
import { chromium } from "playwright-core";
import { fileURLToPath } from "node:url";

const BASE = process.env.BASE || "http://localhost:5173";
const API = process.env.API || "http://localhost:4000";
const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const shot = (n) => fileURLToPath(new URL(`./shots/${n}.png`, import.meta.url));
const api = (p) => fetch(`${API}${p}`).then((r) => r.json());
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
  console.log(`  ✔ ${msg}`);
};

const id = Date.now().toString(36);
const username = `e2e-ngo-${id}`;
const password = `pw-${id}-long`;
const orgName = `E2E Relief Trust ${id}`;

const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

// 1 — sign up
await page.goto(`${BASE}/signup`, { waitUntil: "networkidle" });
await page.getByRole("radio", { name: /NGO/ }).click();
await page.getByLabel("Organisation name").fill(orgName);
await page.getByLabel("Username").fill(username);
await page.getByLabel("Password", { exact: true }).fill(password);
await page.getByLabel("Confirm password").fill(password);
await page.screenshot({ path: shot("signup-filled"), fullPage: true });
await page.getByRole("button", { name: /Create ngo account/i }).click();
await page.waitForURL(`${BASE}/ngo`, { timeout: 60_000 });
const me = (await api("/api/directory")).find((a) => a.displayName === orgName);
assert(me && me.kind === "NGO", `account created with its own wallet ${me?.address}`);

// 2 — register on-chain (wallet is unlocked in memory after sign-up: no prompt expected)
await page.getByRole("button", { name: "Post bond and register" }).click();
let ngo;
for (let i = 0; i < 60 && !ngo; i++) {
  await page.waitForTimeout(500);
  ngo = (await api("/api/state")).ngos.find((n) => n.name === orgName);
}
assert(ngo && ngo.admin.toLowerCase() === me.address.toLowerCase(), `NGO #${ngo?.id} registered on-chain by the account's wallet`);
assert(ngo.bond === 10_000, "₹10,000 bond posted from faucet funds");

// 3 — reload: session survives, console shows the registered NGO
await page.reload({ waitUntil: "networkidle" });
await page.getByRole("heading", { name: orgName }).waitFor({ timeout: 15_000 });
assert(true, "session survives a reload (wallet stays encrypted until needed)");
await page.screenshot({ path: shot("signup-ngo-console"), fullPage: true });

// 4 — sign out, sign back in through the form
await page.getByRole("button", { name: new RegExp(orgName) }).click();
await page.getByRole("menuitem", { name: "Sign out" }).click();
await page.getByRole("link", { name: "Sign in" }).first().waitFor();
assert(true, "signed out");
await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
await page.getByLabel("Username").fill(username);
await page.getByLabel("Password").fill("wrong-password");
await page.getByRole("button", { name: "Sign in" }).click();
await page.getByText("Wrong username or password").waitFor();
assert(true, "wrong password rejected");
await page.getByLabel("Password").fill(password);
await page.getByRole("button", { name: "Sign in" }).click();
await page.waitForURL(`${BASE}/ngo`, { timeout: 30_000 });
assert(true, "signed back in → landed in the NGO console");

await browser.close();
if (errors.length) {
  console.log("runtime errors:\n  " + errors.join("\n  "));
  process.exit(1);
}
console.log("✔ sign-up journey passed");
