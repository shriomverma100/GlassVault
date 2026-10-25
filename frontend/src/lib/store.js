import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { api } from "./api";
import { makeChain, reason } from "./chain";

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
  role: localStorage.getItem("gv-role") || "donorPriya",
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

/// Signer, address and contract handles for a role — recomputed only when the role or chain changes.
function identity(chain, config, role) {
  if (!chain || !config) return { address: null, signer: null, c: null };
  const signer = chain.devSigner(role, "A");
  return { address: config.roles[role]?.address ?? null, signer, c: chain.contracts(signer, chain.devSigner(role, "B")) };
}

// ── actions (stable references) ─────────────────────────────────────────────

function toast(t) {
  const id = Math.random().toString(36).slice(2);
  set((s) => ({ toasts: [...s.toasts, { id, tone: "info", ...t }] }));
  setTimeout(() => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })), t.ms ?? 5000);
}

function switchRole(role) {
  localStorage.setItem("gv-role", role);
  set((s) => ({ role, ...identity(s.chain, s.config, role) }));
}

// One send queue per role: a send starts only after the previous one reached the chain, so the
// wallet's pending-nonce lookup never hands the same nonce to two rapid clicks.
const sendQueues = new Map();

/// Runs `fn` (returns a tx or a promise of a tx), waits for it, toasts the outcome.
async function tx(label, fn) {
  const { role } = snap;
  toast({ title: label, body: "Waiting for confirmation…", tone: "pending", ms: 2500 });
  const sending = (sendQueues.get(role) ?? Promise.resolve()).then(() => fn());
  sendQueues.set(role, sending.catch(() => {}));
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
  switchRole,
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
      set((s) => ({ config, chain, ...identity(chain, config, s.role) }));
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
