import { AnimatePresence, motion } from "framer-motion";
import { useApp } from "../lib/store";
import { Button, Rupees } from "./ui/kit";
import { SnowLockIcon } from "./icons";
import { liquid } from "../lib/motion";

/// Full-screen moment when the contract auto-freezes an NGO. Driven by the live NGOFrozen event.
export default function FreezeFrame() {
  const { frozenAlert, dismissFrozen, state } = useApp("frozenAlert", "dismissFrozen", "state");
  const ngo = frozenAlert && state?.ngos[Number(frozenAlert.args.ngoId)];
  const protectedAmt = ngo ? state.lots.filter((l) => l.ngoId === ngo.id).reduce((s, l) => s + l.remaining, 0) : 0;
  const flags = ngo ? state.flags.filter((f) => f.ngoId === ngo.id) : [];

  return (
    <AnimatePresence>
      {frozenAlert && (
        <motion.div data-overlay="freeze" className="fixed inset-0 z-[70] grid place-items-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          {/* solid scrim, opacity only: a full-screen backdrop blur + animated clip-path repaints every frame */}
          <motion.div className="absolute inset-0 bg-obsidian/90" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }} />
          <motion.div
            className="absolute inset-0 opacity-30"
            style={{ backgroundImage: "repeating-linear-gradient(60deg, rgb(255 255 255 / .25) 0 1px, transparent 1px 14px), repeating-linear-gradient(-60deg, rgb(255 255 255 / .18) 0 1px, transparent 1px 18px)" }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.3 }}
            transition={{ delay: 0.15, duration: 0.4 }}
          />
          <motion.div initial={{ scale: 0.92, y: 20, opacity: 0 }} animate={{ scale: 1, y: 0, opacity: 1 }} transition={{ ...liquid, delay: 0.08 }} className="relative w-[620px] max-w-[92vw] rounded-[var(--radius-card)] border border-white/15 bg-charcoal p-10 text-white">
            {/* vault bolts sliding shut */}
            <div className="mb-8 flex items-center gap-4">
              <div className="relative grid h-20 w-20 place-items-center rounded-full border border-white/20">
                <motion.span initial={{ rotate: -120 }} animate={{ rotate: 0 }} transition={{ type: "spring", stiffness: 260, damping: 16, delay: 0.15 }}>
                  <SnowLockIcon size={40} />
                </motion.span>
              </div>
              <div className="flex gap-2">
                {[0, 1, 2].map((i) => (
                  <motion.span key={i} className="h-3 w-14 rounded-full bg-white" initial={{ x: 60, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ ...liquid, delay: 0.2 + i * 0.06 }} />
                ))}
              </div>
            </div>
            <div className="text-[13px] font-medium text-white/75">Escrow frozen by contract · no human pressed a button</div>
            <h2 className="mt-2 font-display text-[44px] leading-tight font-normal">{ngo?.name ?? `NGO ${frozenAlert.args.ngoId}`}</h2>
            <div className="mt-6 flex gap-12">
              <div>
                <div className="text-[13px] text-white/75">Protected</div>
                <div className="font-display text-[36px] font-normal">
                  <Rupees value={protectedAmt} />
                </div>
              </div>
              <div>
                <div className="text-[13px] text-white/75">Fraud flags</div>
                <div className="font-display text-[36px] font-normal">{frozenAlert.args.flagCount}</div>
              </div>
              <div>
                <div className="text-[13px] text-white/75">Trust score</div>
                <div className="font-display text-[36px] font-normal">0</div>
              </div>
            </div>
            <ul className="mt-6 space-y-2 border-t border-white/15 pt-4 text-[14px] text-white/80">
              {flags.map((f) => (
                <li key={f.id} className="flex justify-between gap-4">
                  <span>{f.reason.replace(/([A-Z])/g, " $1").trim()}</span>
                  <span className="font-mono text-[13px] text-white/75">{f.tx.slice(0, 10)}…</span>
                </li>
              ))}
            </ul>
            <div className="mt-8 flex items-center justify-between">
              <span className="text-[13px] text-white/75">Donors can now reclaim every unspent rupee.</span>
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
