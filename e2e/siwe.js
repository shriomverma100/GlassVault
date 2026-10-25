// Sign-In with Ethereum (MetaMask) at the API level: an ethers wallet stands in for MetaMask and signs
// the same EIP-4361 message the browser builds.
//   node e2e/siwe.js
import { createRequire } from "node:module";
// ethers comes from the backend install (the e2e package only ships playwright-core)
const { ethers } = createRequire(new URL("../backend/package.json", import.meta.url))("ethers");

const API = process.env.API || "http://localhost:4000";
const DOMAIN = new URL(API).host; // the Host the server sees for these requests
let cookie = "";

async function call(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const set = res.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0].endsWith("=") ? "" : set.split(";")[0];
  const json = res.status === 204 ? {} : await res.json().catch(() => ({}));
  return { status: res.status, json };
}
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
  console.log(`  ✔ ${msg}`);
};

const message = ({ address, nonce, domain = DOMAIN, chainId = 31337 }) =>
  [
    `${domain} wants you to sign in with your Ethereum account:`,
    address,
    "",
    "Sign in to GlassVault.",
    "",
    `URI: http://${domain}`,
    "Version: 1",
    `Chain ID: ${chainId}`,
    `Nonce: ${nonce}`,
    `Issued At: ${new Date().toISOString()}`,
  ].join("\n");

async function siwe(wallet, opts = {}) {
  const { json } = await call("GET", "/api/auth/siwe/nonce");
  const msg = message({ address: wallet.address, nonce: opts.nonce ?? json.nonce, domain: opts.domain });
  const out = await call("POST", "/api/auth/siwe", { message: msg, signature: await wallet.signMessage(msg) });
  return { ...out, nonce: json.nonce, msg };
}

const wallet = ethers.Wallet.createRandom(); // "MetaMask"
const username = `mm-${Date.now().toString(36)}`;

// 1 — first sign-in: unknown wallet → sign-up token
const first = await siwe(wallet);
assert(first.status === 200 && first.json.needsSignup && first.json.address === wallet.address, "new MetaMask wallet → asked to create an account");

// 2 — sign up with the token (no password, no keystore)
const signup = await call("POST", "/api/auth/siwe/signup", { signupToken: first.json.signupToken, username, kind: "Donor", displayName: "MetaMask Donor" });
assert(signup.status === 201 && signup.json.user.wallet === "metamask" && signup.json.user.address === wallet.address, "account created for the MetaMask address");
const me = await call("GET", "/api/auth/me");
assert(me.json.user?.wallet === "metamask" && me.json.keystore === null, "session active · wallet = metamask · server holds no keystore");
const reuseToken = await call("POST", "/api/auth/siwe/signup", { signupToken: first.json.signupToken, username: `${username}x`, kind: "Donor", displayName: "x" });
assert(reuseToken.status === 401, "sign-up token is single use");

// 3 — sign out, sign back in with MetaMask
await call("POST", "/api/auth/logout", {});
assert((await call("GET", "/api/auth/me")).json.user === null, "signed out");
const again = await siwe(wallet);
assert(again.status === 200 && again.json.user?.username === username, "MetaMask sign-in logs the existing account in");

// 4 — replay and phishing protection
const replay = await call("POST", "/api/auth/siwe", { message: again.msg, signature: await wallet.signMessage(again.msg) });
assert(replay.status === 401, "a used nonce can't be replayed");
const phishing = await siwe(wallet, { domain: "evil.example" });
assert(phishing.status === 401, "a message signed for another site is rejected");
const impostor = ethers.Wallet.createRandom();
const { json: n } = await call("GET", "/api/auth/siwe/nonce");
const forged = message({ address: wallet.address, nonce: n.nonce });
const stolen = await call("POST", "/api/auth/siwe", { message: forged, signature: await impostor.signMessage(forged) });
assert(stolen.status === 401, "someone else's signature can't claim this address");

// 5 — no password path into a MetaMask account
await call("POST", "/api/auth/logout", {});
const pw = await call("POST", "/api/auth/login", { username, password: "" });
assert(pw.status === 401, "password login is rejected for a MetaMask account");

console.log("✔ MetaMask sign-in passed");
