// MetaMask path through the real UI. The page gets an EIP-1193 wallet announced over EIP-6963 as
// "io.metamask" — the same interface the MetaMask extension exposes — whose key lives in this test
// process (as MetaMask's lives in the extension). The app's own MetaMask code runs unchanged: chain
// add/switch, Sign-In with Ethereum, transactions on chain A and on chain B.
//   node e2e/metamask.js
import { chromium } from "playwright-core";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const { ethers } = createRequire(new URL("../backend/package.json", import.meta.url))("ethers");
const BASE = process.env.BASE || "http://localhost:5173";
const API = process.env.API || "http://localhost:4000";
const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const shot = (n) => fileURLToPath(new URL(`./shots/${n}.png`, import.meta.url));
const api = (p) => fetch(`${API}${p}`).then((r) => r.json());
/// The page navigates as soon as the receipt lands; the indexer catches up within a poll or two.
async function lotFromUrl(page) {
  const id = Number(page.url().split("/").pop());
  for (let i = 0; i < 40; i++) {
    const lot = (await api("/api/state")).lots[id];
    if (lot) return lot;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`lot #${id} never indexed`);
}
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
  console.log(`  ✔ ${msg}`);
};

// ── the wallet ("MetaMask"): one key, two networks it learns about through wallet_addEthereumChain ──
const config = await api("/api/config");
const key = ethers.Wallet.createRandom().privateKey;
const networks = new Map(); // hex chainId → JsonRpcProvider
let current = null;
const log = []; // every wallet prompt the app triggered
const wallet = () => new ethers.Wallet(key, networks.get(current));
const address = new ethers.Wallet(key).address;

async function handle(method, params) {
  switch (method) {
    case "eth_requestAccounts":
    case "eth_accounts":
      return [address];
    case "eth_chainId":
      return current ?? "0x1";
    case "net_version":
      return String(parseInt(current ?? "0x1", 16));
    case "wallet_switchEthereumChain":
      if (!networks.has(params[0].chainId)) return { __error: { code: 4902, message: "Unrecognized chain" } };
      log.push(`switch ${parseInt(params[0].chainId, 16)}`);
      current = params[0].chainId;
      return null;
    case "wallet_addEthereumChain": {
      const c = params[0];
      networks.set(c.chainId, new ethers.JsonRpcProvider(c.rpcUrls[0], undefined, { staticNetwork: true, cacheTimeout: -1 }));
      log.push(`add ${parseInt(c.chainId, 16)} ${c.chainName}`);
      current = c.chainId;
      return null;
    }
    case "personal_sign":
      log.push("personal_sign (Sign-In with Ethereum)");
      return new ethers.Wallet(key).signMessage(ethers.getBytes(params[0]));
    case "eth_signTypedData_v4": {
      const { domain, types, message, primaryType } = JSON.parse(params[1]);
      delete types.EIP712Domain;
      log.push(`signTypedData ${primaryType}`);
      return new ethers.Wallet(key).signTypedData(domain, types, message);
    }
    case "eth_sendTransaction": {
      const t = params[0];
      const tx = await wallet().sendTransaction({ to: t.to, data: t.data, value: t.value ?? 0, gasLimit: t.gas ?? undefined });
      log.push(`send on ${parseInt(current, 16)} → ${t.to?.slice(0, 10)}`);
      return tx.hash;
    }
    default:
      if (!current) return { __error: { code: 4100, message: `no network for ${method}` } };
      return networks.get(current).send(method, params);
  }
}

const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.exposeFunction("__walletRequest", async (method, params) => {
  try {
    return await handle(method, params ?? []);
  } catch (e) {
    return { __error: { code: e.code ?? -32603, message: e.shortMessage ?? e.message } };
  }
});
await ctx.addInitScript(() => {
  const listeners = {};
  const provider = {
    isMetaMask: true,
    async request({ method, params }) {
      const out = await window.__walletRequest(method, params);
      if (out && out.__error) throw Object.assign(new Error(out.__error.message), { code: out.__error.code });
      return out;
    },
    on: (ev, fn) => ((listeners[ev] ??= []).push(fn), provider),
    removeListener: () => provider,
  };
  const announce = () =>
    window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info: { uuid: "e2e-metamask", name: "MetaMask", icon: "data:,", rdns: "io.metamask" }, provider }) }));
  window.addEventListener("eip6963:requestProvider", announce);
  window.ethereum = provider;
});
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

// 1 — sign in with MetaMask: unknown wallet → sign-up as a donor (no password)
await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Continue with MetaMask" }).click();
await page.waitForURL(`${BASE}/signup`, { timeout: 30_000 });
await page.getByText(/verified — every transaction will ask MetaMask to confirm/).waitFor();
assert(log.some((l) => l.startsWith("add 31337")) && log.includes("personal_sign (Sign-In with Ethereum)"), "MetaMask added GlassVault chain A and signed the Sign-In with Ethereum message");
const username = `mm-${Date.now().toString(36)}`;
await page.getByRole("radio", { name: /Donor/ }).click();
await page.getByLabel("Your name").fill("Meera (MetaMask)");
await page.getByLabel("Username").fill(username);
await page.getByRole("button", { name: /Create donor account/i }).click();
await page.waitForURL(`${BASE}/passport`, { timeout: 60_000 });
const me = (await api("/api/directory")).find((a) => a.address.toLowerCase() === address.toLowerCase());
assert(me?.kind === "Donor", `account created for the MetaMask address ${address.slice(0, 10)}…`);

// 2 — donate on chain A: approve + donate are MetaMask transactions
await page.goto(`${BASE}/donate`, { waitUntil: "networkidle" });
await page.getByText("Asha Foundation").first().click();
await page.getByRole("button", { name: "Water" }).click();
await page.locator('input[type="number"]').first().fill("2500");
await page.getByRole("button", { name: "Donate", exact: true }).click();
await page.waitForURL(/\/passport\/\d+/, { timeout: 60_000 });
const lotA = await lotFromUrl(page);
assert(lotA.donor.toLowerCase() === address.toLowerCase() && lotA.amount === 2500, `donation on chain A signed in MetaMask → lot #${lotA.id} (₹2,500 Water)`);

// 3 — pay in ETH on chain B: MetaMask switches to chain B, swap + bridge, relayed to chain A
await page.goto(`${BASE}/donate`, { waitUntil: "networkidle" });
await page.getByText("Asha Foundation").first().click();
await page.getByRole("button", { name: "Water" }).click();
await page.getByRole("button", { name: /Chain B · via bridge/ }).click();
await page.getByRole("button", { name: /Pay in ETH · swapped/ }).click();
await page.getByLabel("Amount (ETH)").fill("0.05");
await page.getByText(/Swaps to about ₹10,000/).waitFor({ timeout: 15_000 });
await page.getByRole("button", { name: "Swap, bridge and donate" }).click();
await page.waitForURL(/\/passport\/\d+/, { timeout: 90_000 });
const lotB = await lotFromUrl(page);
assert(log.some((l) => l.startsWith("add 31338") || l === "switch 31338"), "MetaMask switched to GlassVault chain B for the swap");
assert(lotB.donor.toLowerCase() === address.toLowerCase() && lotB.origin?.asset === "ETH" && lotB.amount === 10_000, `ETH donation on chain B → swapped, bridged → lot #${lotB.id} keeps the MetaMask donor`);
await page.screenshot({ path: shot("metamask-passport"), fullPage: true });

// 4 — sign out and back in with MetaMask: no password anywhere
await page.getByRole("button", { name: /Meera \(MetaMask\)/ }).click();
await page.getByRole("menuitem", { name: "Sign out" }).click();
await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Continue with MetaMask" }).click();
await page.waitForURL(`${BASE}/passport`, { timeout: 30_000 });
assert(true, "signed back in with MetaMask → My donations");
console.log(`  · wallet prompts: ${log.length} (${[...new Set(log.map((l) => l.split(" ")[0]))].join(", ")})`);

await browser.close();
if (errors.length) {
  console.log("runtime errors:\n  " + errors.join("\n  "));
  process.exit(1);
}
console.log("✔ MetaMask journey passed");
