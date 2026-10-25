import { motion } from "framer-motion";
import { drift, liquid } from "../lib/motion";
import { ShieldCheckIcon, CrossIcon, GavelIcon, SnowLockIcon } from "./icons";

/// The 4 evaluation roots as one horizontal spine. Every donation is drawn on it.
export const ROOTS = ["Inbound donation", "Escrow condition", "Off-chain invoice proof", "Impact verification"];

/// status: done | pending | disputed | fraud | frozen | idle
function Node({ status }) {
  const base = "relative grid h-14 w-14 place-items-center rounded-full";
  if (status === "done")
    return (
      <span className={`${base} overflow-hidden border border-signal-deep bg-white`}>
        {/* water rising: the node fills from the bottom */}
        <motion.span className="absolute inset-x-0 bottom-0 bg-signal" initial={{ height: "0%" }} animate={{ height: "100%" }} transition={{ ...liquid, delay: 0.15 }} />
        <span className="relative z-10 text-obsidian">
          <ShieldCheckIcon size={22} />
        </span>
      </span>
    );
  if (status === "pending")
    return (
      <span className={`${base} border-2 border-signal-deep bg-white`}>
        <motion.span
          className="absolute inset-1.5 rounded-full border border-dashed border-signal-deep"
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 8, ease: "linear" }}
        />
      </span>
    );
  if (status === "fraud")
    return (
      <span className={`${base} hatch bg-obsidian text-white`}>
        <CrossIcon size={22} />
      </span>
    );
  if (status === "disputed")
    return (
      <span className={`${base} border-2 border-dashed border-obsidian bg-white text-obsidian`}>
        <GavelIcon size={22} />
      </span>
    );
  if (status === "frozen")
    return (
      <span className={`${base} bg-obsidian text-white`}>
        <SnowLockIcon size={22} />
      </span>
    );
  return <span className={`${base} border border-hairline bg-paper`} />;
}

/// steps: [{ status, detail }] for the 4 roots. `detail` renders under its node, hung on a connector.
export default function ProofSpine({ steps = [], compact = false }) {
  const doneUpTo = steps.reduce((acc, s, i) => (s?.status === "done" ? i : acc), -1);
  return (
    <div className={`relative ${compact ? "py-6" : "py-10"}`}>
      {/* base hairline + yellow progress over the proven part */}
      <div className="absolute left-[12.5%] w-[75%]" style={{ top: compact ? 51 : 67 }}>
        <motion.div className="h-px origin-left bg-hairline" initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={drift} />
        {doneUpTo > 0 && (
          <motion.div
            className="absolute top-[-0.5px] left-0 h-[2px] origin-left bg-signal-deep"
            style={{ width: `${(doneUpTo / 3) * 100}%` }}
            initial={{ scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={{ ...drift, delay: 0.2 }}
          />
        )}
      </div>
      <div className="relative grid grid-cols-4">
        {ROOTS.map((label, i) => (
          <div key={label} className="flex flex-col items-center gap-3 px-3">
            <Node status={steps[i]?.status ?? "idle"} />
            <span className="text-[13px] text-graphite">0{i + 1}</span>
            <span className="text-center text-[14px] font-medium">{label}</span>
            {steps[i]?.detail && (
              <>
                <span className="h-6 w-px bg-hairline" />
                <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ ...liquid, delay: 0.1 * i }} className="w-full">
                  {steps[i].detail}
                </motion.div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
