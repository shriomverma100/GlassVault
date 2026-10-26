// "Verify it yourself" page: answers come from the chain node in the browser, not from our API.
// Checks: an exact committed receipt is found; a re-scanned copy (re-encoded, brighter, cropped) is
// recognised as the receipt behind that payout; an unknown file is rejected; a payout's history and
// the NGOs' freeze status are read from contract storage.
//   node e2e/verify.js        (against a running stack)
import { chromium } from "playwright-core";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = process.env.BASE || "http://localhost:5173";
const API = process.env.API || "http://localhost:4000";
const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gv-verify-"));
const api = (p) => fetch(`${API}${p}`).then((r) => r.json());

const state = await api("/api/state");
const invoices = await api("/api/invoices");
const target = state.payouts.find((p) => invoices.some((i) => i.fileHash === p.fileHash && i.cid));
if (!target) throw new Error("no payout with a stored receipt image — seed the chain first");
const cid = invoices.find((i) => i.fileHash === target.fileHash).cid;
const original = path.join(tmp, "receipt.png");
fs.writeFileSync(original, Buffer.from(await (await fetch(`${API}/ipfs/${cid}`)).arrayBuffer()));

const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(`${BASE}/verify`, { waitUntil: "networkidle" });
await page.keyboard.press("Escape");
await page.getByText(/Latest block/).waitFor();
await page.getByText(/^#\d+$/).first().waitFor({ timeout: 15_000 });
console.log("  ✔ page reads the chain node directly (contract, chain id, live block height)");

const drop = async (file) => {
  await page.locator('input[type="file"]').setInputFiles(file);
  await page.getByText("Hashing and reading the chain…").waitFor({ state: "detached", timeout: 60_000 });
};

await drop(original);
await page.getByText(`This exact file backs payout #${target.id}`).waitFor({ timeout: 30_000 });
console.log(`  ✔ exact receipt → "backs payout #${target.id}" (fingerprint matched in contract storage)`);

// a re-scan: re-encoded as JPEG, slightly brighter, 2% cropped — a new file hash, the same photo
const rescanUrl = await page.evaluate(async (src) => {
  const img = await createImageBitmap(await (await fetch(src)).blob());
  const c = Object.assign(document.createElement("canvas"), { width: img.width, height: img.height });
  const x = c.getContext("2d");
  x.filter = "brightness(1.06)";
  const dx = img.width * 0.02;
  const dy = img.height * 0.02;
  x.drawImage(img, dx, dy, img.width - 2 * dx, img.height - 2 * dy, 0, 0, img.width, img.height);
  return c.toDataURL("image/jpeg", 0.85);
}, `/ipfs/${cid}`);
const rescan = path.join(tmp, "rescan.jpg");
fs.writeFileSync(rescan, Buffer.from(rescanUrl.split(",")[1], "base64"));
await drop(rescan);
await page.getByText(`it looks like the receipt behind payout #${target.id}`).first().waitFor({ timeout: 60_000 });
console.log(`  ✔ re-scanned copy (new hash) → "looks like the receipt behind payout #${target.id}"`);

const unknown = path.join(tmp, "unknown.png");
const blank = await page.evaluate(() => {
  const c = Object.assign(document.createElement("canvas"), { width: 300, height: 200 });
  const x = c.getContext("2d");
  for (let i = 0; i < 40; i++) {
    x.fillStyle = `hsl(${i * 37}, 70%, ${30 + (i % 5) * 10}%)`;
    x.fillRect((i * 53) % 300, (i * 29) % 200, 40, 25);
  }
  return c.toDataURL("image/png");
});
fs.writeFileSync(unknown, Buffer.from(blank.split(",")[1], "base64"));
await drop(unknown);
await page.getByText("No payment on the chain is backed by this file").waitFor({ timeout: 60_000 });
console.log("  ✔ unrelated file → \"No payment on the chain is backed by this file\"");

await page.getByLabel("Payout number").fill(String(target.id));
await page.getByRole("button", { name: "Read it from the chain" }).click();
await page.getByText(`Payout #${target.id} ·`).waitFor({ timeout: 30_000 });
await page.getByText("PayoutRequested", { exact: true }).waitFor();
console.log(`  ✔ payout #${target.id} audited from contract storage + event log`);

await page.getByText(/Frozen by contract|Active/).first().waitFor({ timeout: 15_000 });
console.log("  ✔ NGO freeze status read from contract storage");
await page.screenshot({ path: path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, "$1")), "shots", "verify.png"), fullPage: true });

await browser.close();
if (errors.length) throw new Error("page errors: " + errors.join("; "));
console.log("✔ verify-it-yourself passed");
