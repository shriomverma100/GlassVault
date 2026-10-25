// One command to run the whole platform from scratch:
//   chain A (:8545) + chain B (:8546) → deploy contracts → backend (:4000) → seed real history → frontend (:5173)
//
//   npm start                     fresh chains, deploy, seed, run everything (dev server, hot reload)
//   npm start -- --no-seed        same, but leave the chain empty
//   npm start -- --prod           serve the optimized production build instead of the dev server
//   npm start -- --profile=test   isolated stack on ports +10000 with its own state dir (.gv/test),
//                                 so e2e runs never touch a developer's running session
//
// Ctrl+C stops every process.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const seed = !process.argv.includes("--no-seed");
const prod = process.argv.includes("--prod");
const profile = process.argv.find((a) => a.startsWith("--profile="))?.split("=")[1] ?? "default";
const children = [];

// The default profile keeps the historical ports and folders; any other profile is offset and isolated.
const isolated = profile !== "default";
const off = isolated ? 10_000 : 0;
const P = { a: 8545 + off, b: 8546 + off, api: 4000 + off, web: 5173 + off };
const STATE = isolated ? path.join(ROOT, ".gv", profile) : null;
const ENV = {
  RPC_A: `http://127.0.0.1:${P.a}`,
  RPC_B: `http://127.0.0.1:${P.b}`,
  PORT: String(P.api),
  API: `http://localhost:${P.api}`,
  GV_API: `http://localhost:${P.api}`,
  GV_WEB_PORT: String(P.web),
  ...(STATE ? { GV_SHARED_DIR: path.join(STATE, "shared"), GV_DATA_DIR: path.join(STATE, "data") } : {}),
};
const DATA_DIR = ENV.GV_DATA_DIR ?? path.join(ROOT, "backend", "data");

const tag = (name) => (line) => line.trim() && console.log(`[${name}] ${line}`);
function run(name, cmd, cwd, { quiet = false, env } = {}) {
  // A quiet child's stdout must be DISCARDED, not left unread in a pipe: Hardhat logs every tx,
  // and once an unread pipe buffer fills the node blocks and the chain stops answering.
  const child = spawn(cmd, {
    cwd: path.join(ROOT, cwd),
    shell: true,
    env: { ...process.env, ...ENV, ...env },
    stdio: ["ignore", quiet ? "ignore" : "pipe", "pipe"],
  });
  children.push(child);
  const out = tag(name);
  child.stdout?.on("data", (d) => String(d).split("\n").forEach(out));
  child.stderr.on("data", (d) => String(d).split("\n").forEach(out));
  return child;
}

function once(name, cmd, cwd) {
  return new Promise((resolve, reject) => {
    const child = run(name, cmd, cwd);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${name} exited with ${code}`))));
  });
}

async function waitFor(url, body, label) {
  for (let i = 0; i < 120; i++) {
    try {
      const res = await fetch(url, body ? { method: "POST", headers: { "content-type": "application/json" }, body } : undefined);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${label} did not start`);
}

const rpc = JSON.stringify({ jsonrpc: "2.0", method: "eth_chainId", id: 1 });

function shutdown() {
  for (const c of children) {
    try {
      if (process.platform === "win32") spawn("taskkill", ["/pid", String(c.pid), "/T", "/F"]);
      else c.kill("SIGTERM");
    } catch {}
  }
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

try {
  console.log("▸ starting chains");
  run("chainA", `npx hardhat node --port ${P.a}`, "contracts", { quiet: true });
  run("chainB", `npx hardhat node --port ${P.b}`, "contracts", { quiet: true, env: { CHAIN_ID: "31338" } });
  await waitFor(ENV.RPC_A, rpc, "chain A");
  await waitFor(ENV.RPC_B, rpc, "chain B");

  console.log("▸ deploying contracts to both chains");
  await once("deploy", "npm run deploy", "contracts");
  fs.rmSync(DATA_DIR, { recursive: true, force: true }); // fresh chain → fresh off-chain index

  console.log("▸ starting backend");
  run("backend", "node src/server.js", "backend");
  await waitFor(`${ENV.API}/api/health`, null, "backend");

  if (seed) {
    console.log("▸ seeding real on-chain history");
    await once("seed", "node scripts/seed.js", "backend");
  }

  if (prod) {
    console.log("▸ building frontend (production)");
    await once("build", "npx vite build", "frontend");
  }
  console.log("▸ starting frontend");
  run("frontend", prod ? "npx vite preview" : "npx vite", "frontend");
  const url = `http://localhost:${P.web}`;
  await waitFor(url, null, "frontend");
  console.log(`\n  GlassVault is live → ${url}  (${prod ? "production build" : "dev server"}, profile ${profile})\n  (Ctrl+C to stop everything)\n`);
} catch (e) {
  console.error(`✖ ${e.message}`);
  shutdown();
}
