import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useApp } from "../lib/store";
import { api } from "../lib/api";
import { DEMO_ACCOUNTS } from "../lib/demo-accounts";
import { DRILL, DRILL_FILES, loadDrill, saveDrill } from "../lib/drill";
import { CheckIcon } from "./icons";

const ACCOUNT = Object.fromEntries(DEMO_ACCOUNTS.map(([u, , kind, name, password]) => [u, { kind, name, password }]));
const PAD = 8;
const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const typing = (el) => el && (["INPUT", "TEXTAREA", "SELECT", "BUTTON", "A"].includes(el.tagName) || el.isContentEditable);

/// **bold** and `code` inside a drill line.
function Rich({ text }) {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) =>
    part.startsWith("**") ? (
      <b key={i} className="font-semibold text-obsidian">
        {part.slice(2, -2)}
      </b>
    ) : part.startsWith("`") ? (
      <code key={i} className="rounded bg-bone px-1.5 py-0.5 font-mono text-[12px] text-obsidian">
        {part.slice(1, -1)}
      </code>
    ) : (
      part
    ),
  );
}

function CopyChip({ text, value }) {
  const [ok, setOk] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const t = Object.assign(document.createElement("textarea"), { value });
      document.body.append(t);
      t.select();
      document.execCommand("copy");
      t.remove();
    }
    setOk(true);
    setTimeout(() => setOk(false), 1200);
  };
  return (
    <button
      type="button"
      onClick={copy}
      title="Copy"
      className={`group flex w-full items-center justify-between gap-2 rounded-[12px] border px-3 py-1.5 text-left font-mono text-[12.5px] transition-colors ${ok ? "border-signal-deep bg-signal-mist" : "border-hairline bg-white hover:border-ash/40"}`}
    >
      <span className="truncate">{text}</span>
      <span className="shrink-0 font-sans text-[11px] text-graphite">{ok ? "Copied ✓" : "Copy"}</span>
    </button>
  );
}

/// The judges' drill: a docked, non-blocking guide through every role. Starts from the "Drill" button
/// above "Tour"; remembers its place across account switches and reloads (session only).
export default function Drill() {
  const { user, state, login, logout } = useApp("user", "state", "login", "logout");
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [d, setD] = useState(() => loadDrill() ?? { open: false, step: 0, base: null, mem: {}, keys: {} });
  const [mini, setMini] = useState(false);
  const [covered, setCovered] = useState(false); // a drawer / freeze / unlock overlay is open → step aside
  const [rect, setRect] = useState(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState(null);
  const [directory, setDirectory] = useState([]);
  const update = useCallback((patch) => setD((cur) => ({ ...cur, ...(typeof patch === "function" ? patch(cur) : patch) })), []);
  useEffect(() => saveDrill(d), [d]);
  // dock: the page reserves room for the open panel (index.css)
  useEffect(() => {
    document.documentElement.dataset.drill = d.open && !mini ? "open" : "closed";
  }, [d.open, mini]);
  // overlays (QR-card drawer, freeze frame, unlock prompt) sit on the right too: collapse while one is open
  useEffect(() => {
    if (!d.open) return;
    const id = setInterval(() => setCovered(!!document.querySelector("[data-overlay]")), 250);
    return () => clearInterval(id);
  }, [d.open]);
  const folded = mini || covered;

  const current = d.open ? DRILL[d.step] : null;
  const live = useRef({ state });
  live.current = { state };

  const start = useCallback(async () => {
    setErr(null);
    setMini(false);
    const saved = loadDrill();
    if (saved?.base) return update({ open: true }); // resume where we were
    const s = live.current.state;
    const invoices = await api.get("/api/invoices").catch(() => []);
    update({ open: true, step: 0, mem: {}, keys: {}, base: { lots: s.lots.length, payouts: s.payouts.length, batches: s.batches.length, invoice: Math.max(-1, ...invoices.map((i) => i.id)) } });
  }, [update]);
  const restart = useCallback(() => {
    saveDrill(null);
    setD({ open: false, step: 0, base: null, mem: {}, keys: {} });
    setTimeout(start, 0);
  }, [start]);
  const close = useCallback(() => update({ open: false }), [update]);
  const go = useCallback((i) => update({ step: Math.max(0, Math.min(DRILL.length - 1, i)) }), [update]);

  useEffect(() => {
    window.__gvStartDrill = start;
    window.__gvDrillGo = go;
    return () => {
      delete window.__gvStartDrill;
      delete window.__gvDrillGo;
    };
  }, [start, go]);

  useEffect(() => {
    if (d.open && !directory.length) api.get("/api/directory").then(setDirectory).catch(() => {});
  }, [d.open, directory.length]);
  const addr = useCallback((username) => directory.find((x) => x.displayName === ACCOUNT[username]?.name)?.address, [directory]);

  const needsRole = current && ACCOUNT[current.role];
  const rightRole = !needsRole || user?.username === current.role;

  // on entering a step as the right person, open its page
  const lastStep = useRef(null);
  useEffect(() => {
    if (!current) return;
    const entering = lastStep.current !== d.step;
    lastStep.current = d.step;
    setDone(false);
    if (entering && rightRole && current.route && pathname !== current.route) navigate(current.route);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.step, d.open]);

  // live check against the chain + card-key capture, every 1.5 s while open
  useEffect(() => {
    if (!current || !d.base) return;
    let stop = false;
    const tick = async () => {
      if (current.captureKeys) {
        const keys = [...document.querySelectorAll("[data-card-key]")].map((el) => el.textContent.trim()).filter(Boolean);
        if (keys.length && keys.join() !== (d.keys[current.captureKeys] ?? []).join()) update((cur) => ({ keys: { ...cur.keys, [current.captureKeys]: keys } }));
      }
      if (!current.check || !live.current.state) return; // app still loading (e.g. right after a reload)
      const invoices = current.id === "invoice" || current.id === "rescan" ? await api.get("/api/invoices").catch(() => []) : [];
      const mem = { ...d.mem };
      const ok = !!current.check({ state: live.current.state, base: d.base, mem, invoices, addr });
      if (stop) return;
      setDone(ok);
      if (JSON.stringify(mem) !== JSON.stringify(d.mem)) update({ mem });
    };
    tick();
    const id = setInterval(tick, 1500);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [current, d.base, d.mem, d.keys, addr, update]);

  // highlight the step's target on the page (no dimming — the page stays usable)
  useEffect(() => {
    if (!current?.target || !rightRole || mini) return setRect(null);
    let raf;
    let found = null;
    const t0 = performance.now();
    const loop = () => {
      const el = document.querySelector(`[data-tour="${current.target}"]`);
      if (el && el !== found) {
        found = el;
        el.scrollIntoView({ block: "center", behavior: reducedMotion() ? "auto" : "smooth" });
      }
      if (found && document.contains(found)) {
        const r = found.getBoundingClientRect();
        setRect((p) => (p && Math.abs(p.top - r.top) < 0.5 && Math.abs(p.left - r.left) < 0.5 && p.width === r.width && p.height === r.height ? p : { top: r.top, left: r.left, width: r.width, height: r.height }));
      } else if (performance.now() - t0 > 4000) {
        setRect(null);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [current, pathname, rightRole, mini]);

  // keyboard: Enter / → next, ← back, Esc closes (place kept) — never while typing in a field
  useEffect(() => {
    if (!d.open) return;
    const onKey = (e) => {
      if (document.querySelector('[role="dialog"]')) return; // a tour, unlock or freeze dialog owns the keys
      if (e.key === "Escape") return close();
      if (typing(document.activeElement)) return;
      if (e.key === "Enter" || e.key === "ArrowRight") {
        e.preventDefault();
        go(d.step + 1);
      }
      if (e.key === "ArrowLeft") go(d.step - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [d.open, d.step, go, close]);

  async function switchTo(username) {
    setBusy(username);
    setErr(null);
    try {
      if (user) await logout();
      await login(username, ACCOUNT[username].password);
      if (current?.route) navigate(current.route);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(null);
    }
  }
  async function signOut() {
    setBusy("guest");
    await logout().catch(() => {});
    setBusy(null);
    if (current?.route) navigate(current.route);
  }

  return (
    <>
      {!navigator.webdriver && (
        <button
          type="button"
          onClick={start}
          aria-label="Start the judges' drill"
          className="fixed right-6 bottom-[84px] z-[65] flex h-12 items-center gap-2 rounded-full bg-signal pr-5 pl-4 text-[14px] font-medium text-obsidian shadow-[0_8px_24px_-12px_rgb(18_18_18/0.5)] transition-[background-color,box-shadow] hover:bg-signal-soft"
        >
          <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 3v14M4 4h10l-2 3.5L14 11H4" />
          </svg>
          Drill
        </button>
      )}

      {current && rect && rightRole && !folded && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed z-[70] rounded-[18px] border-2 border-signal-deep shadow-[0_0_0_6px_rgb(220_211_90/0.25)] transition-all duration-300"
          style={{ top: rect.top - PAD, left: rect.left - PAD, width: rect.width + 2 * PAD, height: rect.height + 2 * PAD }}
        />
      )}

      {current && folded && (
        <button
          type="button"
          onClick={() => setMini(false)}
          className="page-enter fixed bottom-6 left-6 z-[95] flex h-11 items-center gap-2 rounded-full border border-hairline bg-paper px-4 text-[13px] font-medium shadow-[0_10px_30px_-18px_rgb(18_18_18/0.6)]"
        >
          <span className="h-2 w-2 rounded-full bg-signal-deep" />
          Drill · step {d.step + 1}/{DRILL.length} · {covered ? "back when you close this" : "show"}
        </button>
      )}

      {current && !folded && (
        <aside
          aria-label="Judges' drill"
          data-drill-step={current.id}
          className="page-enter fixed top-[104px] right-4 z-[80] flex max-h-[calc(100vh-200px)] w-[400px] flex-col overflow-hidden rounded-[var(--radius-tile)] border border-hairline bg-paper shadow-[0_24px_60px_-28px_rgb(18_18_18/0.55)]"
        >
          <header className="flex items-center gap-2 border-b border-hairline px-5 py-3 text-[12px] text-graphite">
            <span className="rounded-full bg-obsidian px-2 py-0.5 font-medium text-white">Drill</span>
            <span className="font-medium">{current.part}</span>
            <span className="ml-auto tabular">
              {d.step + 1} / {DRILL.length}
            </span>
            <button type="button" onClick={() => setMini(true)} className="rounded-full px-2 py-0.5 hover:bg-bone" title="Minimise">
              –
            </button>
            <button type="button" onClick={close} className="rounded-full px-2 py-0.5 hover:bg-bone" title="Close (your place is kept)">
              ✕
            </button>
          </header>

          <div className="flex-1 overflow-y-auto px-5 py-4">
            <h2 className="font-display text-[21px] leading-tight">{current.title}</h2>
            {current.optional && <p className="mt-1 text-[12px] font-medium text-graphite">Optional — skip with Enter if MetaMask isn’t installed.</p>}

            {/* who */}
            <div className="mt-4 rounded-[14px] border border-hairline bg-white p-3">
              {needsRole ? (
                rightRole ? (
                  <div className="flex items-center gap-2 text-[13px]">
                    <span className="grid h-5 w-5 place-items-center rounded-full bg-signal-deep text-white">
                      <CheckIcon size={12} />
                    </span>
                    Signed in as <b>{current.role}</b> · {ACCOUNT[current.role].name}
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    <div className="text-[13px] text-ash">
                      Be <b className="text-obsidian">{ACCOUNT[current.role].name}</b> ({ACCOUNT[current.role].kind})
                      <span className="ml-1 font-mono text-[12px]">
                        {current.role} / {ACCOUNT[current.role].password}
                      </span>
                    </div>
                    <button
                      type="button"
                      data-drill-switch={current.role}
                      onClick={() => switchTo(current.role)}
                      disabled={!!busy}
                      className="h-10 rounded-full bg-obsidian text-[14px] font-medium text-white transition-colors hover:bg-charcoal disabled:opacity-50"
                    >
                      {busy === current.role ? "Signing in…" : `Sign in as ${current.role}`}
                    </button>
                  </div>
                )
              ) : current.role === "guest" ? (
                <div className="flex items-center justify-between gap-2 text-[13px] text-ash">
                  <span>{user ? "Best shown signed out (as any visitor)." : "Signed out — exactly what any visitor sees."}</span>
                  {user && (
                    <button type="button" onClick={signOut} className="shrink-0 rounded-full border border-hairline px-3 py-1 font-medium text-obsidian hover:border-ash/40">
                      {busy === "guest" ? "…" : "Sign out"}
                    </button>
                  )}
                </div>
              ) : current.role === "terminal" ? (
                <div className="text-[13px] text-ash">In a terminal, not the browser.</div>
              ) : (
                <div className="text-[13px] text-ash">Anyone — signed in or not.</div>
              )}
              {current.route && (rightRole || !needsRole) && pathname !== current.route && (
                <button type="button" onClick={() => navigate(current.route)} className="mt-2 text-[13px] font-medium underline underline-offset-4">
                  Open {current.route}
                </button>
              )}
              {err && <p className="mt-2 rounded-[10px] bg-obsidian px-3 py-2 text-[12px] text-white">{err}</p>}
            </div>

            {/* do */}
            <div className="mt-4 text-[12px] font-medium tracking-wide text-graphite uppercase">Do</div>
            <ol className="mt-1.5 flex flex-col gap-1.5 text-[14px] leading-snug text-ash">
              {current.do.map((line, i) => (typeof line === "string" ? <li key={i}><Rich text={line} /></li> : <li key={i}><CopyChip text={line.text} value={line.copy} /></li>))}
            </ol>

            {current.upload && (
              <>
                <div className="mt-4 text-[12px] font-medium tracking-wide text-graphite uppercase">Upload</div>
                <div className="mt-1.5 flex flex-col gap-1.5">
                  {current.upload.map((k) => (
                    <a
                      key={k}
                      href={`/drill/${DRILL_FILES[k].file}`}
                      download={DRILL_FILES[k].file}
                      className="flex items-center gap-3 rounded-[12px] border border-hairline bg-white p-2 pr-3 transition-colors hover:border-ash/40"
                    >
                      <img src={`/drill/${DRILL_FILES[k].file}`} alt="" className="h-11 w-11 rounded-[8px] border border-hairline object-cover" />
                      <span className="flex-1">
                        <span className="block text-[13px] font-medium">{DRILL_FILES[k].label}</span>
                        <span className="block font-mono text-[11px] text-graphite">{DRILL_FILES[k].file}</span>
                      </span>
                      <span className="text-[12px] font-medium">Download</span>
                    </a>
                  ))}
                </div>
              </>
            )}

            {current.showKeys && (
              <>
                <div className="mt-4 text-[12px] font-medium tracking-wide text-graphite uppercase">Card keys (saved at step 6)</div>
                <div className="mt-1.5 flex flex-col gap-1.5">
                  {(d.keys[current.showKeys] ?? []).length ? (
                    d.keys[current.showKeys].map((k, i) => <CopyChip key={k} text={`Card ${i + 1} · ${k.slice(0, 14)}…`} value={k} />)
                  ) : (
                    <p className="text-[13px] text-graphite">Not captured — copy them from the cards shown at step 6.</p>
                  )}
                </div>
              </>
            )}

            {/* expect */}
            <div className={`mt-4 rounded-[14px] border p-3 text-[13px] leading-snug transition-colors ${done ? "border-signal-deep bg-signal-mist" : "border-hairline bg-white"}`}>
              <div className="mb-1 flex items-center gap-2 text-[12px] font-medium">
                {current.check ? (
                  done ? (
                    <>
                      <span className="grid h-4 w-4 place-items-center rounded-full bg-signal-deep text-white">
                        <CheckIcon size={10} />
                      </span>
                      Done — detected on the chain
                    </>
                  ) : (
                    <>
                      <span className="h-2 w-2 animate-pulse rounded-full bg-graphite" /> Watching the chain…
                    </>
                  )
                ) : (
                  "You should see"
                )}
              </div>
              <span className="text-ash">{current.expect}</span>
            </div>
            {current.why && (
              <p className="mt-3 text-[12.5px] leading-relaxed text-graphite">
                <b className="text-ash">Why: </b>
                {current.why}
              </p>
            )}
          </div>

          <footer className="border-t border-hairline px-5 py-3">
            <div className="mb-3 flex gap-1" aria-hidden="true">
              {DRILL.map((s, i) => (
                <button
                  key={s.id}
                  type="button"
                  tabIndex={-1}
                  onClick={() => go(i)}
                  title={`${i + 1}. ${s.title}`}
                  className={`h-1.5 flex-1 rounded-full transition-colors ${i === d.step ? "bg-obsidian" : i < d.step ? "bg-signal-deep" : "bg-hairline hover:bg-ash/40"}`}
                />
              ))}
            </div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={restart} className="mr-auto text-[12px] text-graphite underline underline-offset-4">
                Restart
              </button>
              {d.step > 0 && (
                <button type="button" onClick={() => go(d.step - 1)} className="h-10 rounded-full border border-hairline bg-white px-4 text-[14px] font-medium hover:border-ash">
                  Back
                </button>
              )}
              <button
                type="button"
                onClick={() => (d.step < DRILL.length - 1 ? go(d.step + 1) : close())}
                className="h-10 rounded-full bg-signal px-5 text-[14px] font-medium text-obsidian transition-colors hover:bg-signal-soft"
              >
                {d.step < DRILL.length - 1 ? "Next ↵" : "Finish"}
              </button>
            </div>
          </footer>
        </aside>
      )}
    </>
  );
}
