import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useApp } from "../lib/store";
import { tourFor, tourKey } from "../lib/tours";

const seen = (key) => {
  try {
    return localStorage.getItem(key) === "done";
  } catch {
    return true; // no storage (private mode / previews): never auto-start
  }
};
const markSeen = (key) => {
  try {
    localStorage.setItem(key, "done");
  } catch {
    // storage unavailable — the tour simply may show again
  }
};
const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const PAD = 8;

/// Role-based guided tour: auto-starts the first time each account (or a guest) arrives, can be
/// skipped at any step, and restarts from the floating "Tour" button in the bottom-right corner.
export default function Tour() {
  const { user, authReady, state } = useApp("user", "authReady", "state");
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [step, setStep] = useState(null); // null = closed
  const [rect, setRect] = useState(null);
  // steps are built when the tour starts, from this account's state at that moment (registered yet?
  // donated yet?), and stay fixed while it runs
  const [steps, setSteps] = useState(() => tourFor(user, state));
  const key = tourKey(user);
  const live = useRef({ user, state });
  live.current = { user, state };

  const start = useCallback(() => {
    setSteps(tourFor(live.current.user, live.current.state));
    setRect(null);
    setStep(0);
  }, []);
  const close = useCallback(() => {
    markSeen(key);
    setStep(null);
    setRect(null);
  }, [key]);

  // test hook — automated browsers never auto-start the tour
  useEffect(() => {
    window.__gvStartTour = start;
    return () => delete window.__gvStartTour;
  }, [start]);

  // first visit for this account (or guest) → start once the app has loaded
  useEffect(() => {
    if (!authReady || !state || navigator.webdriver || seen(key)) return;
    const id = setTimeout(start, 700);
    return () => clearTimeout(id);
  }, [authReady, state, key, start]);

  // switching account mid-tour closes it (the next account gets its own tour)
  const lastKey = useRef(key);
  useEffect(() => {
    if (lastKey.current !== key) {
      lastKey.current = key;
      setStep(null);
    }
  }, [key]);

  const current = step === null ? null : steps[step];

  // go to the step's page, wait for its target, scroll it into view and follow it while open
  useEffect(() => {
    if (!current) return;
    if (current.route && pathname !== current.route) {
      navigate(current.route);
      return;
    }
    if (!current.target) {
      setRect(null);
      return;
    }
    let raf;
    let found = null;
    const startedAt = performance.now();
    const loop = () => {
      const el = document.querySelector(`[data-tour="${current.target}"]`);
      if (el && !found) {
        found = el;
        el.scrollIntoView({ block: "center", behavior: reducedMotion() ? "auto" : "smooth" });
      }
      if (found) {
        const r = found.getBoundingClientRect();
        setRect((prev) => (prev && Math.abs(prev.top - r.top) < 0.5 && Math.abs(prev.left - r.left) < 0.5 && prev.width === r.width && prev.height === r.height ? prev : { top: r.top, left: r.left, width: r.width, height: r.height }));
      } else if (performance.now() - startedAt > 2500) {
        setRect(null); // target not on this page right now (e.g. not registered yet) → centred card
        return;
      }
      raf = requestAnimationFrame(loop);
    };
    setRect(null);
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [current, pathname, navigate]);

  // keyboard: Esc skips, ← → navigate
  useEffect(() => {
    if (step === null) return;
    const onKey = (e) => {
      if (e.key === "Escape") close();
      if (e.key === "ArrowRight") {
        if (step < steps.length - 1) setStep(step + 1);
        else close();
      }
      if (e.key === "ArrowLeft") setStep(Math.max(0, step - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, steps.length, close]);

  return (
    <>
      {/* hidden for automated browsers so it can't cover what tests click; tests use window.__gvStartTour() */}
      {!navigator.webdriver && (
      <button
        type="button"
        onClick={start}
        aria-label="Start the guided tour"
        className="fixed right-6 bottom-6 z-[65] flex h-12 items-center gap-2 rounded-full bg-obsidian pr-5 pl-4 text-[14px] font-medium text-white hover:bg-charcoal"
      >
        <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <circle cx="10" cy="10" r="7.5" />
          <path d="M8 7.8a2.1 2.1 0 1 1 2.9 2c-.6.3-.9.7-.9 1.4v.3M10 14.2v.1" strokeLinecap="round" />
        </svg>
        Tour
      </button>
      )}
      {current && <Overlay rect={rect} step={step} steps={steps} current={current} onNext={() => (step < steps.length - 1 ? setStep(step + 1) : close())} onBack={() => setStep(Math.max(0, step - 1))} onSkip={close} />}
    </>
  );
}

function Overlay({ rect, step, steps, current, onNext, onBack, onSkip }) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const hole = rect && { x: Math.max(4, rect.left - PAD), y: Math.max(4, rect.top - PAD), w: Math.min(vw - 8, rect.width + 2 * PAD), h: Math.min(vh - 8, rect.height + 2 * PAD) };
  const W = Math.min(400, vw - 32);
  // card below the target if it fits, else above, else centred
  let pos = { left: (vw - W) / 2, top: Math.max(24, vh / 2 - 130) };
  if (hole) {
    const left = Math.min(Math.max(16, hole.x), vw - W - 16);
    if (hole.y + hole.h + 230 < vh) pos = { left, top: hole.y + hole.h + 14 };
    else if (hole.y > 250) pos = { left, top: hole.y - 14 - 220 };
  }
  const last = step === steps.length - 1;
  return (
    <div className="fixed inset-0 z-[90]" role="dialog" aria-modal="false" aria-labelledby="tour-title">
      <svg className="pointer-events-none fixed inset-0" width={vw} height={vh} aria-hidden="true">
        <defs>
          <mask id="tour-hole">
            <rect x="0" y="0" width={vw} height={vh} fill="white" />
            {hole && <rect x={hole.x} y={hole.y} width={hole.w} height={hole.h} rx="16" fill="black" />}
          </mask>
        </defs>
        <rect x="0" y="0" width={vw} height={vh} fill="rgb(18 18 18 / 0.55)" mask="url(#tour-hole)" />
        {hole && <rect x={hole.x} y={hole.y} width={hole.w} height={hole.h} rx="16" fill="none" stroke="var(--color-signal)" strokeWidth="2" />}
      </svg>
      <div className="page-enter fixed rounded-[var(--radius-tile)] border border-hairline bg-paper p-6" style={{ left: pos.left, top: pos.top, width: W }}>
        <div className="flex items-center justify-between text-[13px] text-ash">
          <span className="font-medium tabular">
            Step {step + 1} of {steps.length}
          </span>
          <button type="button" onClick={onSkip} className="font-medium text-obsidian underline underline-offset-4">
            Skip tour
          </button>
        </div>
        <h2 id="tour-title" className="mt-3 font-display text-[22px] leading-tight">
          {current.title}
        </h2>
        <p className="mt-2 text-[14px] leading-relaxed text-ash">{current.body}</p>
        <div className="mt-5 flex items-center gap-2">
          <div className="mr-auto flex gap-1" aria-hidden="true">
            {steps.map((_, i) => (
              <span key={i} className={`h-1.5 rounded-full ${i === step ? "w-5 bg-obsidian" : i < step ? "w-1.5 bg-signal-deep" : "w-1.5 bg-hairline"}`} />
            ))}
          </div>
          {step > 0 && (
            <button type="button" onClick={onBack} className="h-10 rounded-full border border-hairline bg-white px-4 text-[14px] font-medium hover:border-ash">
              Back
            </button>
          )}
          <button type="button" autoFocus onClick={onNext} className="h-10 rounded-full bg-signal px-5 text-[14px] font-medium text-obsidian hover:bg-signal-soft">
            {last ? "Done" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}
