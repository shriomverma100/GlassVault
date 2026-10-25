// Stops a running GlassVault stack (chains, backend, frontend) by the ports it listens on.
//   npm run stop                  → the default stack (8545, 8546, 4000, 5173)
//   npm run stop -- --profile=test → an isolated profile (ports +10000)
import { execSync } from "node:child_process";

const profile = process.argv.find((a) => a.startsWith("--profile="))?.split("=")[1] ?? "default";
const off = profile === "default" ? 0 : 10_000;
const ports = [8545, 8546, 4000, 5173].map((p) => p + off);
const win = process.platform === "win32";
let stopped = 0;
for (const port of ports) {
  const pids = win
    ? execSync("netstat -ano", { encoding: "utf8" }) // IPv4 and IPv6 (Vite listens on [::1]).split("\n").filter((l) => l.includes(`:${port} `) && l.includes("LISTENING")).map((l) => l.trim().split(/\s+/).at(-1))
    : execSync(`lsof -ti tcp:${port} -sTCP:LISTEN || true`, { encoding: "utf8" }).split("\n").filter(Boolean);
  for (const pid of new Set(pids)) {
    try {
      process.kill(Number(pid), "SIGKILL"); // works on Windows too (TerminateProcess), unlike a shelled taskkill
      console.log(`stopped port ${port} (pid ${pid})`);
      stopped++;
    } catch {}
  }
}
console.log(stopped ? `GlassVault (${profile}) stopped.` : `nothing was running for profile ${profile}.`);
