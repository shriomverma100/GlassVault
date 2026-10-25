import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api } from "./api";
import { makeChain, reason } from "./chain";

const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

/// Global app state: config, live chain state over WebSocket, the acting role (signer), toasts,
/// and a `tx()` helper that runs a transaction with pending/success/error feedback.
export function AppProvider({ children }) {
  const [config, setConfig] = useState(null);
  const [state, setState] = useState(null);
  const [events, setEvents] = useState([]);
  const [findings, setFindings] = useState([]);
  const [benchmark, setBenchmark] = useState(null);
  const [frozenAlert, setFrozenAlert] = useState(null);
  const [role, setRole] = useState(() => localStorage.getItem("gv-role") || "donorPriya");
  const [toasts, setToasts] = useState([]);
  const [clockSkew, setClockSkew] = useState(0);

  useEffect(() => {
    api.get("/api/config").then((c) => setConfig({ ...c, rpcA: `${location.origin}/rpcA`, rpcB: `${location.origin}/rpcB` }));
    api.get("/api/events?limit=200").then(setEvents);
    api.get("/api/watcher").then(setFindings);
  }, []);

  const chain = useMemo(() => (config ? makeChain(config) : null), [config]);

  // Chain clock: Hardhat time can run ahead of the wall clock, so countdowns use block time.
  useEffect(() => {
    if (!chain) return;
    const sync = () =>
      chain.providerA.getBlock("latest").then((b) => b && setClockSkew(b.timestamp - Math.floor(Date.now() / 1000))).catch(() => {});
    sync();
    const id = setInterval(sync, 5000);
    return () => clearInterval(id);
  }, [chain]);

  const toast = useCallback((t) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((xs) => [...xs, { id, tone: "info", ...t }]);
    setTimeout(() => setToasts((xs) => xs.filter((x) => x.id !== id)), t.ms ?? 5000);
  }, []);

  useEffect(() => {
    let ws;
    let stop = false;
    const connect = () => {
      ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
      ws.onmessage = (m) => {
        const { type, payload } = JSON.parse(m.data);
        if (type === "state" && payload) setState(payload);
        if (type === "event") {
          setEvents((xs) => [payload, ...xs].slice(0, 300));
          // the socket only pushes live events, so this is a freeze happening right now
          if (payload.name === "NGOFrozen") setFrozenAlert(payload);
        }
        if (type === "watcher") setFindings((xs) => [payload, ...xs].slice(0, 200));
        if (type === "benchmark") setBenchmark(payload);
      };
      ws.onclose = () => !stop && setTimeout(connect, 1000);
    };
    connect();
    return () => {
      stop = true;
      ws?.close();
    };
  }, []);

  const switchRole = (r) => {
    localStorage.setItem("gv-role", r);
    setRole(r);
  };

  const address = config?.roles[role]?.address;
  const signer = chain ? chain.devSigner(role, "A") : null;
  const signerB = chain ? chain.devSigner(role, "B") : null;
  const c = useMemo(() => (chain && signer ? chain.contracts(signer, signerB) : null), [chain, signer, signerB]);

  /// Runs `fn` (returns a tx or a promise of a tx), waits for it, toasts the outcome.
  const tx = useCallback(
    async (label, fn) => {
      toast({ title: label, body: "Waiting for confirmation…", tone: "pending", ms: 2500 });
      try {
        const sent = await fn();
        const rc = await sent.wait();
        toast({ title: label, body: `Confirmed in block ${rc.blockNumber}`, tone: "ok", hash: rc.hash });
        return rc;
      } catch (e) {
        toast({ title: label, body: reason(e), tone: "error", ms: 8000 });
        throw e;
      }
    },
    [toast],
  );

  const chainNow = () => Math.floor(Date.now() / 1000) + clockSkew;

  const value = {
    config,
    chain,
    state,
    events,
    findings,
    benchmark,
    setBenchmark,
    role,
    switchRole,
    address,
    signer,
    c,
    tx,
    toast,
    toasts,
    chainNow,
    frozenAlert,
    dismissFrozen: () => setFrozenAlert(null),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/// Re-renders every second — for countdowns.
export function useTick(ms = 1000) {
  const [, set] = useState(0);
  useEffect(() => {
    const id = setInterval(() => set((x) => x + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
}
