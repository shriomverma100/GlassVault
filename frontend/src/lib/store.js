import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ethers } from "ethers";
import { api } from "./api";
import { makeChain, reason } from "./chain";
import { setDirectory } from "./derive";
import { createWallet, unlockWallet } from "./wallet";

/// Global app state: config, live chain state over WebSocket, the acting role (signer), toasts,
/// and a `tx()` helper that runs a transaction with pending/success/error feedback.
///
/// A plain external store instead of one React context: components subscribe to the keys they read,
/// so a toast, a clock sync or a new feed event re-renders only the components that show it — not
/// the whole page. Functions on the store are stable, so they never trigger renders.
let snap = {
  config: null,
  chain: null,
  state: null,
  events: [],
  findings: [],
  benchmark: null,
  relayer: null, // latest bridge relayer status: delivered | failed
  frozenAlert: null,
  authReady: false, // true once we know whether a session exists
  user: null, // { id, username, kind, displayName, address }
  keystore: null, // encrypted wallet JSON (from the server, decryptable only with the password)
  wallet: null, // unlocked ethers.Wallet — memory only, gone on reload/logout
  unlockRequest: null, // pending "enter your password to sign" prompt
  address: null,
  signer: null,
  c: null,
  toasts: [],
  clockSkew: 0,
};
const listeners = new Set();
const subscribe = (fn) => (listeners.add(fn), () => listeners.delete(fn));

function set(partial) {
  snap = { ...snap, ...(typeof partial === "function" ? partial(snap) : partial) };
  listeners.forEach((fn) => fn());
}

/// Signs with the account wallet; if it is locked (page reload), asks for the password first and then
/// continues the same action. Contracts are bound to it once, so components never hold a stale signer.
class AccountSigner extends ethers.AbstractSigner {
  constructor(address, provider) {
    super(provider);
    this.address = address;
  }
  connect(provider) {
    return new AccountSigner(this.address, provider);
  }
  async getAddress() {
    return this.address;
  }
  async #wallet() {
    return (await requireWallet()).connect(this.provider);
  }
  async signTransaction(tx) {
    return (await this.#wallet()).signTransaction(tx);
  }
  async sendTransaction(tx) {
    return (await this.#wallet()).sendTransaction(tx);
  }
  async signMessage(m) {
    return (await this.#wallet()).signMessage(m);
  }
  async signTypedData(domain, types, value) {
    return (await this.#wallet()).signTypedData(domain, types, value);
  }
}

/// Signer, address and contract handles for the signed-in account (read-only when signed out).
function identity(chain, user) {
  if (!chain) return { address: null, signer: null, c: null };
  if (!user) return { address: null, signer: null, c: chain.contracts() };
  const signer = new AccountSigner(user.address, chain.providerA);
  return { address: user.address, signer, c: chain.contracts(signer, signer.connect(chain.providerB)) };
}

function requireWallet() {
  if (snap.wallet) return Promise.resolve(snap.wallet);
  if (!snap.keystore) return Promise.reject(new Error("Sign in to do this"));
  return new Promise((resolve, reject) => set({ unlockRequest: { resolve, reject } }));
}

// ── actions (stable references) ─────────────────────────────────────────────

function toast(t) {
  const id = Math.random().toString(36).slice(2);
  set((s) => ({ toasts: [...s.toasts, { id, tone: "info", ...t }] }));
  setTimeout(() => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })), t.ms ?? 5000);
}

// ── accounts ────────────────────────────────────────────────────────────────

const loadDirectory = () => api.get("/api/directory").then(setDirectory).catch(() => {});

function signedIn(user, keystore, wallet) {
  set((s) => ({ user, keystore, wallet, unlockRequest: null, ...identity(s.chain, user) }));
}

async function login(username, password) {
  const { user, keystore } = await api.post("/api/auth/login", { username: username.trim().toLowerCase(), password });
  signedIn(user, keystore, await unlockWallet(keystore, password));
  return user;
}

/// Creates the wallet in the browser, then the account. Returns the user (wallet unlocked).
async function signup({ username, password, kind, displayName }) {
  const { address, keystore } = await createWallet(password);
  const { user } = await api.post("/api/auth/signup", { username: username.trim().toLowerCase(), password, kind, displayName: displayName.trim(), address, keystore });
  signedIn(user, keystore, await unlockWallet(keystore, password));
  loadDirectory();
  return user;
}

async function logout() {
  await api.post("/api/auth/logout").catch(() => {});
  snap.unlockRequest?.reject(new Error("Signed out"));
  signedIn(null, null, null);
}

/// Answers the unlock prompt. Throws "Wrong password" so the prompt can say so and stay open.
async function unlock(password) {
  const wallet = await unlockWallet(snap.keystore, password);
  const req = snap.unlockRequest;
  set({ wallet, unlockRequest: null });
  req?.resolve(wallet);
}

function cancelUnlock() {
  snap.unlockRequest?.reject(new Error("Signing cancelled"));
  set({ unlockRequest: null });
}

// One send queue per account: a send starts only after the previous one reached the chain, so the
// wallet's pending-nonce lookup never hands the same nonce to two rapid clicks.
const sendQueues = new Map();

/// Runs `fn` (returns a tx or a promise of a tx), waits for it, toasts the outcome.
async function tx(label, fn) {
  const who = snap.user?.address ?? "anon";
  toast({ title: label, body: "Waiting for confirmation…", tone: "pending", ms: 2500 });
  const sending = (sendQueues.get(who) ?? Promise.resolve()).then(() => fn());
  sendQueues.set(who, sending.catch(() => {}));
  try {
    const sent = await sending;
    const rc = await sent.wait();
    toast({ title: label, body: `Confirmed in block ${rc.blockNumber}`, tone: "ok", hash: rc.hash });
    return rc;
  } catch (e) {
    toast({ title: label, body: reason(e), tone: "error", ms: 8000 });
    throw e;
  }
}

/// Chain clock: Hardhat time can run ahead of the wall clock, so countdowns use block time.
const chainNow = () => Math.floor(Date.now() / 1000) + snap.clockSkew;

const actions = {
  toast,
  tx,
  login,
  signup,
  logout,
  unlock,
  cancelUnlock,
  loadDirectory,
  chainNow,
  setBenchmark: (benchmark) => set({ benchmark }),
  dismissFrozen: () => set({ frozenAlert: null }),
};

// ── hooks ───────────────────────────────────────────────────────────────────

/// `const { state, tx } = useApp("state", "tx")` — re-renders only when one of the named keys changes.
export function useApp(...keys) {
  const cache = useRef(null);
  const getSnapshot = () => {
    const prev = cache.current;
    if (prev && keys.every((k) => prev[k] === (actions[k] ?? snap[k]))) return prev;
    const next = {};
    for (const k of keys) next[k] = actions[k] ?? snap[k];
    cache.current = next;
    return next;
  };
  return useSyncExternalStore(subscribe, getSnapshot);
}

/// Boots the store: config, history, the WebSocket feed and the chain clock. Renders its children as-is.
export function AppProvider({ children }) {
  useEffect(() => {
    let stop = false;
    let ws;
    let clock;

    api.get("/api/config").then((raw) => {
      if (stop) return;
      const config = { ...raw, rpcA: `${location.origin}/rpcA`, rpcB: `${location.origin}/rpcB` };
      const chain = makeChain(config);
      set((s) => ({ config, chain, ...identity(chain, s.user) }));
      const sync = () =>
        chain.providerA
          .getBlock("latest")
          .then((b) => {
            const clockSkew = b ? b.timestamp - Math.floor(Date.now() / 1000) : snap.clockSkew;
            if (clockSkew !== snap.clockSkew) set({ clockSkew }); // no render when nothing changed
          })
          .catch(() => {});
      sync();
      clock = setInterval(sync, 5000);
    });
    api
      .get("/api/auth/me")
      .then(({ user, keystore }) => !stop && user && signedIn(user, keystore, null))
      .catch(() => {})
      .finally(() => !stop && set({ authReady: true }));
    loadDirectory();
    api.get("/api/events?limit=200").then((events) => !stop && set({ events }));
    api.get("/api/watcher").then((findings) => !stop && set({ findings }));

    const connect = () => {
      ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
      ws.onmessage = (m) => {
        const { type, payload } = JSON.parse(m.data);
        if (type === "state" && payload) set({ state: payload });
        if (type === "event") {
          set((s) => ({
            events: [payload, ...s.events].slice(0, 300),
            // the socket only pushes live events, so this is a freeze happening right now
            ...(payload.name === "NGOFrozen" ? { frozenAlert: payload } : {}),
          }));
        }
        if (type === "watcher") set((s) => ({ findings: [payload, ...s.findings].slice(0, 200) }));
        if (type === "benchmark") set({ benchmark: payload });
        if (type === "relayer") set({ relayer: payload });
      };
      ws.onclose = () => !stop && setTimeout(connect, 1000);
    };
    connect();

    return () => {
      stop = true;
      clearInterval(clock);
      ws?.close();
    };
  }, []);
  return children;
}

/// Re-renders the calling component every `ms` — keep it in the smallest component that shows time.
export function useTick(ms = 1000) {
  const [, setN] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setN((x) => x + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
}

/// Re-renders when chain time crosses the next of `times` (unix seconds) — a challenge window closing,
/// a vote ending, a deadline passing — instead of every second. Countdown text ticks on its own in
/// <Countdown/>, so the surrounding page only re-renders when what it can offer actually changes.
export function useRerenderAt(times) {
  const [n, setN] = useState(0);
  const key = times.filter(Boolean).join(",");
  useEffect(() => {
    const now = chainNow();
    const next = Math.min(...key.split(",").map(Number).filter((t) => t > now));
    if (!Number.isFinite(next)) return;
    const id = setTimeout(() => setN((x) => x + 1), Math.min((next - now) * 1000 + 50, 2 ** 31 - 1));
    return () => clearTimeout(id);
  }, [key, n]);
}

/// Every timestamp at which some payout's available actions change.
export const payoutBoundaries = (payouts) => payouts.flatMap((p) => [p.releaseAt, p.challenge?.voteEnd]);
