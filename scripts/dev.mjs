// One command to run the whole platform from scratch:
//   chain A (:8545) + chain B (:8546) → deploy contracts → backend (:4000) → seed real history → frontend (:5173)
//
//   npm start            fresh chains, deploy, seed, run everything
//   npm start -- --no-seed   same, but leave the chain empty
//
// Ctrl+C stops every process.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const seed = !process.argv.includes("--no-seed");
const children = [];

const tag = (name) => (line) => line.trim() && console.log(`[${name}] ${line}`);
function run(name, cmd, cwd, { quiet = false, env } = {}) {
  // A quiet child's stdout must be DISCARDED, not left unread in a pipe: Hardhat logs every tx,
  // and once an unread pipe buffer fills the node blocks and the chain stops answering.
  const child = spawn(cmd, {
    cwd: path.join(ROOT, cwd),
    shell: true,
    env: { ...process.env, ...env },
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
  run("chainA", "npx hardhat node --port 8545", "contracts", { quiet: true });
  run("chainB", "npx hardhat node --port 8546", "contracts", { quiet: true, env: { CHAIN_ID: "31338" } });
  await waitFor("http://127.0.0.1:8545", rpc, "chain A");
  await waitFor("http://127.0.0.1:8546", rpc, "chain B");

  console.log("▸ deploying contracts to both chains");
  await once("deploy", "npm run deploy", "contracts");
  fs.rmSync(path.join(ROOT, "backend", "data"), { recursive: true, force: true }); // fresh chain → fresh off-chain index

  console.log("▸ starting backend");
  run("backend", "node src/server.js", "backend");
  await waitFor("http://localhost:4000/api/health", null, "backend");

  if (seed) {
    console.log("▸ seeding real on-chain history");
    await once("seed", "node scripts/seed.js", "backend");
  }

  console.log("▸ starting frontend");
  run("frontend", "npx vite --port 5173 --strictPort", "frontend");
  await waitFor("http://localhost:5173", null, "frontend");
  console.log("\n  GlassVault is live → http://localhost:5173\n  (Ctrl+C to stop everything)\n");
} catch (e) {
  console.error(`✖ ${e.message}`);
  shutdown();
}
