import { motion } from "framer-motion";
import { useApp } from "../../lib/store";
import { Empty, HashText, Section } from "../ui/kit";
import { CrackIcon } from "../icons";
import { liquid } from "../../lib/motion";
import { CrackLine, REASONS, timeAgo } from "./shared";

/// Every FraudFlagged event the contract recorded, newest first.
export default function Graveyard() {
  const { state, chainNow } = useApp();
  const flags = [...state.flags].sort((a, b) => b.block - a.block || b.logIndex - a.logIndex);
  const now = chainNow();

  return (
    <Section eyebrow="Recorded on-chain · cannot be deleted" title="Receipt graveyard" action={<span className="text-[13px] text-graphite">{flags.length} fraud attempts</span>}>
      {!flags.length ? (
        <Empty>No fraud attempts yet. Every rejected invoice lands here, forever.</Empty>
      ) : (
        <div className="grid grid-cols-3 gap-4">
          {flags.map((f, i) => {
            const r = REASONS[f.reason] ?? { title: f.reason, text: "" };
            const ngo = state.ngos[f.ngoId];
            return (
              <motion.article
                key={f.id}
                initial={{ opacity: 0, y: 14, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ ...liquid, delay: Math.min(i, 8) * 0.05 }}
                className="hatch relative overflow-hidden rounded-[var(--radius-card)] border border-obsidian bg-obsidian p-6 text-white"
              >
                <CrackLine className="pointer-events-none absolute top-0 right-10 h-full w-10 text-white/35" />
                <div className="relative flex items-start gap-4">
                  {f.file?.cid && f.file.mime?.startsWith("image/") ? (
                    <a href={`/ipfs/${f.file.cid}`} target="_blank" rel="noreferrer" className="shrink-0">
                      <img src={`/ipfs/${f.file.cid}`} alt="Rejected receipt" className="h-24 w-[72px] rounded-[12px] border border-white/20 object-cover grayscale" />
                    </a>
                  ) : (
                    <span className="grid h-24 w-[72px] shrink-0 place-items-center rounded-[12px] border border-white/20 text-white/60">
                      <CrackIcon size={24} />
                    </span>
                  )}
                  <div className="min-w-0">
                    <div className="text-[12px] tracking-wide text-white/55 uppercase">Flag #{f.args.flagCount} · {ngo?.name ?? `NGO ${f.ngoId}`}</div>
                    <h3 className="mt-1 font-display text-[22px] leading-tight font-light">{r.title}</h3>
                    <p className="mt-1 text-[13px] text-white/75">{r.text}</p>
                  </div>
                </div>
                <div className="relative mt-5 flex items-center justify-between border-t border-white/15 pt-3 text-[12px] text-white/55">
                  <span>{timeAgo(f.time, now)}</span>
                  <HashText value={f.tx} className="!text-white/60 hover:!text-white" />
                </div>
              </motion.article>
            );
          })}
        </div>
      )}
    </Section>
  );
}
