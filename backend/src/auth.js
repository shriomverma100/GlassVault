import express from "express";
import { ethers } from "ethers";
import {
  createAccount,
  createSession,
  deleteSession,
  directory,
  dummyPasswordHash,
  markFunded,
  publicUser,
  pruneSessions,
  sessionUser,
  unmarkFunded,
  userByUsername,
  validateSignup,
  verifyPassword,
} from "./accounts.js";

const COOKIE = "gv_session";
const LOCAL_CHAINS = new Set([31337n, 31338n]);
const FAUCET_DINR = ethers.parseUnits("1000000", 18); // ₹10,00,000 per chain
const FAUCET_GAS = ethers.parseEther("10");
const RATE_WINDOW_MS = 15 * 60_000;
const RATE_MAX_FAILS = 10;

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

/// Failed-login limiter, per username and per IP (in memory: resets with the process).
const fails = new Map();
function tooMany(key) {
  const now = Date.now();
  const list = (fails.get(key) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  fails.set(key, list);
  return list.length >= RATE_MAX_FAILS;
}
const recordFail = (key) => fails.set(key, [...(fails.get(key) ?? []), Date.now()]);

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
      const username = String(req.body?.username ?? "").trim().toLowerCase();
      const password = String(req.body?.password ?? "");
      const ipKey = `ip:${req.ip}`;
      const userKey = `user:${username}`;
      if (tooMany(ipKey) || tooMany(userKey)) return res.status(429).json({ error: "Too many failed attempts — try again in 15 minutes" });
      const row = userByUsername(username);
      // always run one scrypt so response time doesn't reveal whether the username exists
      const valid = (await verifyPassword(password, row?.password_hash ?? (await dummyPasswordHash()))) && !!row;
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

  r.post("/auth/logout", (req, res) => {
    deleteSession(tokenOf(req));
    clearSessionCookie(req, res);
    res.status(204).end();
  });

  // A guest is a normal state, not an error: 200 with user null (a 401 here shows up as a console error).
  r.get("/auth/me", (req, res) => res.json(req.user ? { user: publicUser(req.user), keystore: req.user.keystore } : { user: null, keystore: null }));

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
