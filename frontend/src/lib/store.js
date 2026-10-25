import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ethers } from "ethers";
import { api } from "./api";
import { makeChain, reason } from "./chain";
import { setDirectory } from "./derive";
import { createWallet, unlockWallet } from "./wallet";
import * as mm from "./metamask";

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
  user: null, // { id, username, kind, displayName, address, wallet: "keystore" | "metamask" }
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
    if (snap.user?.wallet === "metamask") return metaMaskSigner(this.address, this.provider);
    return (await requireWallet()).connect(this.provider);
  }
  async signTransaction(tx) {
    return (await this.#wallet()).signTransaction(tx);
  }
  async sendTransaction(tx) {
    const sent = await (await this.#wallet()).sendTransaction(tx);
    // follow the receipt on our own provider (fast local polling), not through the wallet
    if (snap.user?.wallet === "metamask") return (await this.provider.getTransaction(sent.hash).catch(() => null)) ?? sent;
    return sent;
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

/// MetaMask signer for the chain this signer's provider points at: switches MetaMask to that chain
/// (adding it if needed) and refuses to sign from a different account than the signed-in one.
async function metaMaskSigner(address, provider) {
  const wallet = await mm.requireWallet();
  const chains = mm.chainSpecs(snap.config);
  await mm.ensureChain(wallet, provider === snap.chain?.providerB ? chains.B : chains.A);
  const selected = await mm.selectedAccount(wallet);
  if (!selected || selected.toLowerCase() !== address.toLowerCase()) throw new Error(`Switch MetaMask to your GlassVault account ${address}`);
  return new ethers.BrowserProvider(wallet).getSigner(address);
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
  if (user?.wallet === "metamask") watchMetaMask();
}

// Warn when MetaMask switches away from the signed-in account (signing would then be refused).
let watching = false;
async function watchMetaMask() {
  if (watching) return;
  const w = await mm.discoverWallet().catch(() => null);
  if (!w?.provider?.on) return;
  watching = true;
  w.provider.on("accountsChanged", (accounts) => {
    const u = snap.user;
    if (u?.wallet === "metamask" && accounts[0]?.toLowerCase() !== u.address.toLowerCase()) {
      toast({ title: "MetaMask account changed", body: `Switch back to ${u.address.slice(0, 8)}… to sign as ${u.displayName}.`, tone: "error", ms: 8000 });
    }
  });
}

/// Sign-In with Ethereum: MetaMask signs a one-time EIP-4361 message. Returns the user, or
/// { needsSignup, signupToken, address } when this wallet has no account yet.
async function loginWithMetaMask() {
  const wallet = await mm.requireWallet();
  const address = ethers.getAddress(await mm.connect());
  const chainA = mm.chainSpecs(snap.config).A;
  await mm.ensureChain(wallet, chainA);
  const { nonce } = await api.get("/api/auth/siwe/nonce");
  const message = mm.siweMessage({ domain: location.host, address, uri: location.origin, chainId: chainA.chainId, nonce });
  const signature = await (await new ethers.BrowserProvider(wallet).getSigner(address)).signMessage(message);
  const out = await api.post("/api/auth/siwe", { message, signature });
  if (out.needsSignup) return out;
  signedIn(out.user, null, null);
  return { user: out.user };
}

async function signupWithMetaMask({ signupToken, username, kind, displayName }) {
  const { user } = await api.post("/api/auth/siwe/signup", { signupToken, username: username.trim().toLowerCase(), kind, displayName: displayName.trim() });
  signedIn(user, null, null);
  loadDirectory();
  return user;
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
  loginWithMetaMask,
  signupWithMetaMask,
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
            // the chain clock may run AHEAD of the wall clock (time travel) but never behind: an idle local
            // chain mines no blocks, yet its next block is stamped "now" — a stale latest block must not
            // freeze countdowns or hide actions whose window has passed
            const clockSkew = b ? Math.max(0, b.timestamp - Math.floor(Date.now() / 1000)) : snap.clockSkew;
            if (clockSkew !== snap.clockSkew) set({ clockSkew }); // no render when nothing changed
          })
          .catch(() => {});
      sync();
      clock = setInterval(sync, 5000);
    });
    api
      .get("/api/auth/me")
      .then(({ user, keystore }) => !stop && user && signedIn(user, keystore, null))
      .catch((e) => {
        // a server from before accounts existed: this page is newer than the running backend
        if (!stop && /not found/i.test(e.message))
          toast({ title: "The running server is out of date", body: "This page is newer than the backend you started. Stop it (Ctrl+C, or npm run stop) and run npm run start:prod — sign-up and sign-in need the current backend.", tone: "error", ms: 600_000 });
      })
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
export const payoutBoundaries = (payouts) => payouts.flatMap((p) => [p.releaseAt, p.challenge?.voteEnd, p.fiatDeadline, p.impactDeadline]);
