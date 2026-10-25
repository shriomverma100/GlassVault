import { motion } from "framer-motion";
import { useApp } from "../lib/store";
import { KpiStat } from "../components/ui/primitives";
import { inrCompact } from "../lib/format";
import { fadeUp, stagger } from "../lib/motion";
import Graveyard from "../components/watch/Graveyard";
import Court from "../components/watch/Court";
import WatcherFeed from "../components/watch/WatcherFeed";
import Reconciler from "../components/watch/Reconciler";
import RedTeam from "../components/watch/RedTeam";
import OffRampWatch from "../components/watch/OffRampWatch";
import StuckMoney from "../components/watch/StuckMoney";

/// The theatre: every fraud attempt, every dispute, the watcher's evidence, and the red team.
export default function Watchtower() {
  const { state } = useApp("state");
  const underChallenge = state.payouts.filter((p) => p.status === "Challenged").length;
  // indexed over the whole chain history (anyone who challenged and won is a watcher)
  const paidToWatchers = inrCompact(state.stats.paidToWatchers ?? 0);

  return (
    <motion.div variants={stagger()} initial="hidden" animate="show">
      <motion.section variants={fadeUp} className="flex items-end justify-between pt-10 pb-8">
        <div>
          <span className="text-[13px] text-graphite">Fraud is recorded, never just rejected</span>
          <h1 className="font-display text-[64px] leading-none font-normal tracking-tight">Watchtower</h1>
        </div>
        <div className="flex gap-16">
          <KpiStat label="Frauds caught" value={state.flags.length} />
          <KpiStat label="NGOs frozen" value={state.stats.frozenNgos} />
          <KpiStat label="Under challenge" value={underChallenge} />
          <KpiStat label="Paid to watchers" {...paidToWatchers} />
        </div>
      </motion.section>
      <motion.div variants={fadeUp}>
        <Graveyard />
      </motion.div>
      <motion.div variants={fadeUp}>
        <Court />
      </motion.div>
      <motion.div variants={fadeUp}>
        <OffRampWatch />
      </motion.div>
      <motion.div variants={fadeUp}>
        <StuckMoney />
      </motion.div>
      <motion.div variants={fadeUp}>
        <WatcherFeed />
      </motion.div>
      <motion.div variants={fadeUp}>
        <Reconciler />
      </motion.div>
      <motion.div variants={fadeUp}>
        <RedTeam />
      </motion.div>
    </motion.div>
  );
}
