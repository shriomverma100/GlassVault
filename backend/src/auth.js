import express from "express";
import { randomBytes } from "node:crypto";
import { ethers } from "ethers";
import {
  createAccount,
  createMetaMaskAccount,
  createSession,
  deleteSession,
  directory,
  dummyPasswordHash,
  markFunded,
  publicUser,
  pruneSessions,
  sessionUser,
  unmarkFunded,
  userByAddress,
  userByUsername,
  validateProfile,
  validateSignup,
  verifyPassword,
} from "./accounts.js";

const COOKIE = "gv_session";
const LOCAL_CHAINS = new Set([31337n, 31338n]);
const FAUCET_DINR = ethers.parseUnits("1000000", 18); // ₹10,00,000 per chain
const FAUCET_GAS = ethers.parseEther("10");
const RATE_WINDOW_MS = 15 * 60_000;
const RATE_MAX_FAILS = 10; // per IP + username
const RATE_MAX_FAILS_IP = 30; // per IP (several people can share one address)
const SIWE_NONCE_MS = 5 * 60_000;
const SIWE_SIGNUP_MS = 10 * 60_000;
const SIWE_SKEW_MS = 5 * 60_000;

/// Sign-In with Ethereum (EIP-4361): single-use nonces and sign-up tokens, in memory.
const siweNonces = new Map(); // nonce → expiresAt
const siweSignups = new Map(); // token → { address, expiresAt }
const sweep = (m, now = Date.now()) => {
  for (const [k, v] of m) if ((v.expiresAt ?? v) < now) m.delete(k);
};

/// Parses the standard EIP-4361 text. Returns null if it isn't one.
function parseSiwe(message) {
  const lines = String(message).split("\n");
  const head = /^(.+) wants you to sign in with your Ethereum account:$/.exec(lines[0] ?? "");
  if (!head || !ethers.isAddress(lines[1] ?? "")) return null;
  const field = (name) => lines.find((l) => l.startsWith(`${name}: `))?.slice(name.length + 2);
  const out = { domain: head[1], address: ethers.getAddress(lines[1]), uri: field("URI"), version: field("Version"), chainId: Number(field("Chain ID")), nonce: field("Nonce"), issuedAt: field("Issued At") };
  return out.uri && out.version === "1" && out.nonce && out.issuedAt && Number.isInteger(out.chainId) ? out : null;
}

/// Sites a sign-in message may be addressed to. Fixed by configuration — never taken from request headers,
/// which a client (or a phishing site relaying a victim's signature) controls.
const WEB_PORT = process.env.GV_WEB_PORT || 5173;
const API_PORT = process.env.PORT || 4000;
const ALLOWED_HOSTS = new Set(
  (process.env.GV_ALLOWED_HOSTS ? process.env.GV_ALLOWED_HOSTS.split(",") : [`localhost:${WEB_PORT}`, `127.0.0.1:${WEB_PORT}`, `localhost:${API_PORT}`, `127.0.0.1:${API_PORT}`])
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean),
);
const hostOf = (uri) => {
  try {
    return new URL(uri).host.toLowerCase();
  } catch {
    return null;
  }
};

function parseCookies(header = "") {
  const out = {};
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

const tokenOf = (req) => parseCookies(req.headers.cookie)[COOKIE];
const isHttps = (req) => req.secure || req.headers["x-forwarded-proto"] === "https";

function setSessionCookie(req, res, { token, maxAge }) {
  res.setHeader("Set-Cookie", `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${isHttps(req) ? "; Secure" : ""}`);
}
const clearSessionCookie = (req, res) =>
  res.setHeader("Set-Cookie", `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${isHttps(req) ? "; Secure" : ""}`);

/// Failed-login limiter, per IP and per IP + username (in memory: resets with the process). Never per
/// username alone — that would let anyone lock a victim out by failing on purpose.
const fails = new Map();
function recent(key) {
  const now = Date.now();
  const list = (fails.get(key) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (list.length) fails.set(key, list);
  else fails.delete(key);
  return list;
}
const tooMany = (key, max = RATE_MAX_FAILS) => recent(key).length >= max;
const recordFail = (key) => fails.set(key, [...recent(key), Date.now()]);
setInterval(() => [...fails.keys()].forEach(recent), RATE_WINDOW_MS).unref(); // drop expired entries

/// Attaches `req.user` (raw row) when a valid session cookie is present.
export function sessionMiddleware(req, _res, next) {
  req.user = sessionUser(tokenOf(req));
  next();
}

export const requireUser = (req, res, next) => (req.user ? next() : res.status(401).json({ error: "Sign in first" }));

/// Only JSON bodies are accepted on state-changing auth routes: a cross-site form post can't send
/// application/json without a CORS preflight, which (with SameSite=Lax cookies) blocks CSRF.
const requireJson = (req, res, next) =>
  req.method !== "POST" || req.is("application/json") ? next() : res.status(415).json({ error: "Content-Type must be application/json" });

/// @param {{ depA, depB, providerA, providerB, funderKey: string, gasKey: string }} chains
export function authRouter({ depA, depB, providerA, providerB, funderKey, gasKey }) {
  const r = express.Router();
  r.use("/auth", requireJson);
  setInterval(pruneSessions, 3600_000).unref();

  r.post("/auth/signup", async (req, res, next) => {
    try {
      const input = validateSignup(req.body);
      if (input.error) return res.status(400).json({ error: input.error });
      const out = await createAccount(input);
      if (out.error) return res.status(out.status).json({ error: out.error });
      setSessionCookie(req, res, createSession(out.user.id));
      res.status(201).json({ user: out.user });
    } catch (e) {
      next(e);
    }
  });

  r.post("/auth/login", async (req, res, next) => {
    try {
      const username = String(req.body?.username ?? "").trim().toLowerCase().slice(0, 32); // usernames are ≤ 32 chars
      const password = String(req.body?.password ?? "").slice(0, 256);
      const ipKey = `ip:${req.ip}`;
      const userKey = `ipuser:${req.ip}:${username}`;
      if (tooMany(ipKey, RATE_MAX_FAILS_IP) || tooMany(userKey)) return res.status(429).json({ error: "Too many failed attempts — try again in 15 minutes" });
      const row = userByUsername(username);
      // always run one scrypt so response time doesn't reveal whether the username exists;
      // MetaMask accounts have no password, so they can never sign in here
      const passwordRow = row && row.wallet !== "metamask" ? row : null;
      const valid = (await verifyPassword(password, passwordRow?.password_hash ?? (await dummyPasswordHash()))) && !!passwordRow;
      if (!valid) {
        recordFail(ipKey);
        recordFail(userKey);
        return res.status(401).json({ error: "Wrong username or password" });
      }
      fails.delete(userKey);
      setSessionCookie(req, res, createSession(row.id));
      res.json({ user: publicUser(row), keystore: row.keystore });
    } catch (e) {
      next(e);
    }
  });

  // ── Sign-In with Ethereum (MetaMask) ──
  r.get("/auth/siwe/nonce", (_req, res) => {
    sweep(siweNonces);
    const nonce = randomBytes(12).toString("hex");
    siweNonces.set(nonce, Date.now() + SIWE_NONCE_MS);
    res.json({ nonce });
  });

  r.post("/auth/siwe", (req, res) => {
    const ipKey = `ip:${req.ip}`;
    if (tooMany(ipKey, RATE_MAX_FAILS_IP)) return res.status(429).json({ error: "Too many failed attempts — try again in 15 minutes" });
    const fail = (error, status = 401) => {
      recordFail(ipKey);
      return res.status(status).json({ error });
    };
    const message = String(req.body?.message ?? "");
    const signature = String(req.body?.signature ?? "");
    if (message.length > 2000) return fail("Sign-in message too long", 400);
    const m = parseSiwe(message);
    if (!m) return fail("Not a valid sign-in message", 400);
    let signer;
    try {
      signer = ethers.verifyMessage(message, signature);
    } catch {
      return fail("Invalid signature");
    }
    if (signer !== m.address) return fail("Signature does not match the address");
    if (!ALLOWED_HOSTS.has(m.domain.toLowerCase()) || hostOf(m.uri) !== m.domain.toLowerCase()) return fail("Sign-in message is for a different site");
    const expires = siweNonces.get(m.nonce);
    siweNonces.delete(m.nonce); // single use, even when the rest fails
    if (!expires || expires < Date.now()) return fail("Sign-in request expired — try again");
    const issued = Date.parse(m.issuedAt);
    if (!Number.isFinite(issued) || Math.abs(Date.now() - issued) > SIWE_SKEW_MS) return fail("Sign-in request expired — try again");

    const row = userByAddress(m.address);
    if (row) {
      setSessionCookie(req, res, createSession(row.id));
      return res.json({ user: publicUser(row), keystore: null });
    }
    sweep(siweSignups);
    const signupToken = randomBytes(24).toString("hex");
    siweSignups.set(signupToken, { address: m.address, expiresAt: Date.now() + SIWE_SIGNUP_MS });
    res.json({ needsSignup: true, address: m.address, signupToken });
  });

  r.post("/auth/siwe/signup", (req, res, next) => {
    try {
      const pending = siweSignups.get(String(req.body?.signupToken ?? ""));
      if (!pending || pending.expiresAt < Date.now()) return res.status(401).json({ error: "Sign-up session expired — connect MetaMask again" });
      const input = validateProfile(req.body);
      if (input.error) return res.status(400).json({ error: input.error });
      const out = createMetaMaskAccount({ ...input, address: pending.address });
      if (out.error) return res.status(out.status).json({ error: out.error });
      siweSignups.delete(String(req.body.signupToken));
      setSessionCookie(req, res, createSession(out.user.id));
      res.status(201).json({ user: out.user });
    } catch (e) {
      next(e);
    }
  });

  r.post("/auth/logout", (req, res) => {
    deleteSession(tokenOf(req));
    clearSessionCookie(req, res);
    res.status(204).end();
  });

  // A guest is a normal state, not an error: 200 with user null (a 401 here shows up as a console error).
  r.get("/auth/me", (req, res) => res.json(req.user ? { user: publicUser(req.user), keystore: req.user.keystore || null } : { user: null, keystore: null }));

  r.get("/directory", (_req, res) => res.json(directory()));

  // ── local-chain faucet: test rupees + gas for a new account ──
  // Mints come from the DINR owner (the deployer); gas from a separate dev account so faucet
  // sends never race the relayer's nonce on the deployer key.
  let queue = Promise.resolve();
  const serial = (fn) => (queue = queue.then(fn, fn));

  async function send(wallet, build, attempt = 0) {
    try {
      const nonce = await wallet.provider.getTransactionCount(wallet.address, "pending");
      const tx = await build(nonce);
      await tx.wait();
      return tx.hash;
    } catch (e) {
      // the relayer shares the deployer key: a nonce race is retried with a fresh pending nonce
      if (attempt < 3 && /nonce/i.test(e.shortMessage || e.message)) return send(wallet, build, attempt + 1);
      throw e;
    }
  }

  r.post("/faucet", requireUser, async (req, res, next) => {
    try {
      const [a, b] = await Promise.all([providerA.getNetwork(), providerB.getNetwork()]);
      if (!LOCAL_CHAINS.has(a.chainId) || !LOCAL_CHAINS.has(b.chainId)) return res.status(403).json({ error: "Faucet is only available on local chains" });
      if (!markFunded(req.user.id)) return res.json({ already: true });
      const to = req.user.address;
      try {
        const txs = await serial(async () => {
          const out = [];
          for (const [provider, dep] of [
            [providerA, depA],
            [providerB, depB],
          ]) {
            const minter = new ethers.Wallet(funderKey, provider);
            const gas = new ethers.Wallet(gasKey, provider);
            const dinr = new ethers.Contract(dep.DINR.address, dep.DINR.abi, minter);
            out.push(await send(gas, (nonce) => gas.sendTransaction({ to, value: FAUCET_GAS, nonce })));
            out.push(await send(minter, (nonce) => dinr.mint(to, FAUCET_DINR, { nonce })));
          }
          return out;
        });
        res.json({ txs });
      } catch (e) {
        unmarkFunded(req.user.id); // let the user retry
        throw e;
      }
    } catch (e) {
      next(e);
    }
  });

  return r;
}
