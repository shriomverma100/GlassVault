import { AnimatePresence, motion } from "framer-motion";
import { useApp } from "../lib/store";
import { Button, Rupees } from "./ui/kit";
import { SnowLockIcon } from "./icons";
import { liquid } from "../lib/motion";

/// Full-screen moment when the contract auto-freezes an NGO. Driven by the live NGOFrozen event.
export default function FreezeFrame() {
  const { frozenAlert, dismissFrozen, state } = useApp();
  const ngo = frozenAlert && state?.ngos[Number(frozenAlert.args.ngoId)];
  const protectedAmt = ngo ? state.lots.filter((l) => l.ngoId === ngo.id).reduce((s, l) => s + l.remaining, 0) : 0;
  const flags = ngo ? state.flags.filter((f) => f.ngoId === ngo.id) : [];

  return (
    <AnimatePresence>
      {frozenAlert && (
        <motion.div className="fixed inset-0 z-[70] grid place-items-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          {/* frost spreading in from the edges */}
          <motion.div
            className="absolute inset-0 bg-obsidian/85 backdrop-blur-sm"
            initial={{ clipPath: "inset(50% 50% 50% 50% round 40px)" }}
            animate={{ clipPath: "inset(0% 0% 0% 0% round 0px)" }}
            transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
          />
          <motion.div
            className="absolute inset-0 opacity-30"
            style={{ backgroundImage: "repeating-linear-gradient(60deg, rgb(255 255 255 / .25) 0 1px, transparent 1px 14px), repeating-linear-gradient(-60deg, rgb(255 255 255 / .18) 0 1px, transparent 1px 18px)" }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.3 }}
            transition={{ delay: 0.5, duration: 1 }}
          />
          <motion.div initial={{ scale: 0.92, y: 20, opacity: 0 }} animate={{ scale: 1, y: 0, opacity: 1 }} transition={{ ...liquid, delay: 0.35 }} className="relative w-[620px] max-w-[92vw] rounded-[var(--radius-card)] border border-white/15 bg-charcoal p-10 text-white">
            {/* vault bolts sliding shut */}
            <div className="mb-8 flex items-center gap-4">
              <div className="relative grid h-20 w-20 place-items-center rounded-full border border-white/20">
                <motion.span initial={{ rotate: -120 }} animate={{ rotate: 0 }} transition={{ type: "spring", stiffness: 120, damping: 12, delay: 0.6 }}>
                  <SnowLockIcon size={40} />
                </motion.span>
              </div>
              <div className="flex gap-2">
                {[0, 1, 2].map((i) => (
                  <motion.span key={i} className="h-3 w-14 rounded-full bg-white" initial={{ x: 60, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ ...liquid, delay: 0.7 + i * 0.12 }} />
                ))}
              </div>
            </div>
            <div className="text-[12px] tracking-wide text-white/60 uppercase">Escrow frozen by contract · no human pressed a button</div>
            <h2 className="mt-2 font-display text-[44px] leading-tight font-light">{ngo?.name ?? `NGO ${frozenAlert.args.ngoId}`}</h2>
            <div className="mt-6 flex gap-12">
              <div>
                <div className="text-[12px] text-white/60">Protected</div>
                <div className="font-display text-[36px] font-light">
                  <Rupees value={protectedAmt} />
                </div>
              </div>
              <div>
                <div className="text-[12px] text-white/60">Fraud flags</div>
                <div className="font-display text-[36px] font-light">{frozenAlert.args.flagCount}</div>
              </div>
              <div>
                <div className="text-[12px] text-white/60">Trust score</div>
                <div className="font-display text-[36px] font-light">0</div>
              </div>
            </div>
            <ul className="mt-6 space-y-2 border-t border-white/15 pt-4 text-[14px] text-white/80">
              {flags.map((f) => (
                <li key={f.id} className="flex justify-between gap-4">
                  <span>{f.reason.replace(/([A-Z])/g, " $1").trim()}</span>
                  <span className="font-mono text-[12px] text-white/50">{f.tx.slice(0, 10)}…</span>
                </li>
              ))}
            </ul>
            <div className="mt-8 flex items-center justify-between">
              <span className="text-[13px] text-white/60">Donors can now reclaim every unspent rupee.</span>
              <Button variant="signal" onClick={dismissFrozen}>
                Understood
              </Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
