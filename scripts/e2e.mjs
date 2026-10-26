// Full end-to-end run on a fresh, isolated stack — never touches a developer's running session.
//   npm run e2e:full     fresh chains + production build on the "test" profile → smoke, flow, attack, perf
// The stack is always torn down afterwards, also on failure.
import { spawn, execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORTS = [18545, 18546, 14000, 15173]; // test profile = default ports + 10000 (see dev.mjs)
const ENV = { ...process.env, BASE: "http://localhost:15173", API: "http://localhost:14000" };
const win = process.platform === "win32";

/// Kill whatever still listens on the test ports (left over from a crashed or killed run).
function freePorts() {
  for (const port of PORTS) {
    try {
      const pids = win
        ? execSync("netstat -ano", { encoding: "utf8" }) // IPv4 and IPv6
            .split("\n")
            .filter((l) => l.includes(`:${port} `) && l.includes("LISTENING"))
            .map((l) => l.trim().split(/\s+/).at(-1))
        : execSync(`lsof -ti tcp:${port} -sTCP:LISTEN || true`, { encoding: "utf8" }).split("\n").filter(Boolean);
      for (const pid of new Set(pids)) execSync(win ? `taskkill /PID ${pid} /T /F` : `kill -9 ${pid}`, { stdio: "ignore" });
    } catch {}
  }
}

function killTree(child) {
  try {
    if (win) execSync(`taskkill /PID ${child.pid} /T /F`, { stdio: "ignore" });
    else process.kill(-child.pid, "SIGKILL");
  } catch {}
}

const runStep = (file) =>
  new Promise((resolve) => {
    const p = spawn(process.execPath, [file], { cwd: ROOT, env: ENV, stdio: "inherit" });
    p.on("exit", (code) => resolve(code === 0));
  });

freePorts();
console.log("▸ starting isolated test stack (production build)");
const stack = spawn(process.execPath, ["scripts/dev.mjs", "--prod", "--profile=test"], { cwd: ROOT, env: process.env, stdio: ["ignore", "pipe", "pipe"], detached: !win });
const ready = new Promise((resolve, reject) => {
  const onData = (d) => {
    const s = String(d);
    if (s.includes("GlassVault is live")) resolve();
    if (s.includes("✖")) reject(new Error(s.trim()));
  };
  stack.stdout.on("data", onData);
  stack.stderr.on("data", onData);
  stack.on("exit", (code) => reject(new Error(`stack exited early (${code})`)));
});

let failed = [];
try {
  await ready;
  for (const step of ["e2e/smoke.js", "e2e/tour.js", "e2e/confidence.js", "e2e/siwe.js", "e2e/metamask.js", "e2e/signup.js", "e2e/multihop.js", "e2e/flow.js", "e2e/attack.js", "e2e/verify.js", "e2e/perf.js"]) {
    console.log(`\n▸ ${step}`);
    if (!(await runStep(step))) failed.push(step);
  }
} catch (e) {
  console.error(`✖ ${e.message}`);
  failed.push("stack");
} finally {
  killTree(stack);
  freePorts();
}
console.log(failed.length ? `\n✖ failed: ${failed.join(", ")}` : "\n✔ all end-to-end checks passed");
process.exit(failed.length ? 1 : 0);
