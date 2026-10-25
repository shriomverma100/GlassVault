// Public link to the running platform through a Cloudflare quick tunnel.
//   npm run share        (with `npm run start:prod` running)
// Prints the https://….trycloudflare.com address and records its host in .gv/shared-hosts.txt, so
// Sign-In with Ethereum accepts messages for that address (the allowlist is never read from requests).
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HOSTS = path.join(ROOT, ".gv", "shared-hosts.txt");
const candidates = ["C:/Program Files (x86)/cloudflared/cloudflared.exe", "C:/Program Files/cloudflared/cloudflared.exe"];
const bin = candidates.find((p) => fs.existsSync(p)) ?? "cloudflared";

const tunnel = spawn(bin, ["tunnel", "--no-autoupdate", "--url", "http://localhost:5173"], { stdio: ["ignore", "pipe", "pipe"] });
let announced = false;
const onData = (d) => {
  const url = String(d).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)?.[0];
  if (!url || announced) return;
  announced = true;
  fs.mkdirSync(path.dirname(HOSTS), { recursive: true });
  fs.writeFileSync(HOSTS, new URL(url).host + "\n");
  console.log(`\n  GlassVault is public → ${url}\n  (keep this window open; Ctrl+C closes the link)\n`);
};
tunnel.stdout.on("data", onData);
tunnel.stderr.on("data", onData);
tunnel.on("exit", (code) => {
  console.log(`tunnel closed (${code})`);
  process.exit(code ?? 0);
});
tunnel.on("error", () => {
  console.error("cloudflared not found — install it with: winget install Cloudflare.cloudflared");
  process.exit(1);
});
process.on("SIGINT", () => tunnel.kill());
