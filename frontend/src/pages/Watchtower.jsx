import { motion } from "framer-motion";
import { ethers } from "ethers";
import { useApp } from "../lib/store";
import { KpiStat } from "../components/ui/primitives";
import { compactInr } from "../components/ui/kit";
import { fadeUp, stagger } from "../lib/motion";
import Graveyard from "../components/watch/Graveyard";
import Court from "../components/watch/Court";
import WatcherFeed from "../components/watch/WatcherFeed";
import Reconciler from "../components/watch/Reconciler";
import RedTeam from "../components/watch/RedTeam";

/// The theatre: every fraud attempt, every dispute, the watcher's evidence, and the red team.
export default function Watchtower() {
  const { state, events, config } = useApp();
  const watcher = config.roles.watcher.address.toLowerCase();
  const underChallenge = state.payouts.filter((p) => p.status === "Challenged").length;
  const watcherRewards = events
    .filter((e) => e.name === "ChallengeResolved" && String(e.args.upheld) === "true")
    .filter((e) => state.payouts[Number(e.args.payoutId)]?.challenge?.challenger?.toLowerCase() === watcher)
    .reduce((s, e) => s + Number(ethers.formatUnits(e.args.reward, 18)), 0);
  const [rv, ru] = compactInr(watcherRewards);

  return (
    <motion.div variants={stagger()} initial="hidden" animate="show">
      <motion.section variants={fadeUp} className="flex items-end justify-between pt-10 pb-8">
        <div>
          <span className="text-[12px] text-graphite">Fraud is recorded, never just rejected</span>
          <h1 className="font-display text-[64px] leading-none font-light tracking-tight">Watchtower</h1>
        </div>
        <div className="flex gap-16">
          <KpiStat label="Frauds caught" value={state.flags.length} />
          <KpiStat label="NGOs frozen" value={state.stats.frozenNgos} />
          <KpiStat label="Under challenge" value={underChallenge} />
          <KpiStat label="Paid to watchers" value={rv} unit={ru} />
        </div>
      </motion.section>
      <motion.div variants={fadeUp}>
        <Graveyard />
      </motion.div>
      <motion.div variants={fadeUp}>
        <Court />
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
