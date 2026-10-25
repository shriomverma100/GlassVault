// Re-runs the probabilistic evaluation chain from the public state and checks it matches what the
// platform publishes — anyone can verify the scores with the open formula.
//   npm run confidence            (API defaults to http://localhost:4000)
import { annotate, FORMULA_VERSION } from "../src/confidence.js";

const API = process.env.API || "http://localhost:4000";
const get = (p) => fetch(`${API}${p}`).then((r) => r.json());

const [state, config, findings] = await Promise.all([get("/api/state"), get("/api/config"), get("/api/watcher")]);
const published = state.lots.map((l) => l.confidence);
const files = Object.fromEntries(state.payouts.map((p) => [p.fileHash, p.receiptAvailable]));
const recomputed = annotate(structuredClone(state), { homeChainId: config.chainA.chainId, findings, files, now: state.chainTime });

console.log(`Probabilistic evaluation chain · formula v${FORMULA_VERSION}\n`);
console.log("  donation  inbound  escrow  impact  invoice   chain   published");
let mismatches = 0;
recomputed.lots.forEach((lot, i) => {
  const c = lot.confidence;
  const s = Object.fromEntries(c.stages.map((x) => [x.key, x.p == null ? "  —  " : x.p.toFixed(3)]));
  const same = published[i]?.score === c.score;
  if (!same) mismatches++;
  console.log(`  #${String(lot.id).padEnd(8)} ${s.inbound}    ${s.escrow}   ${s.impact}   ${s.invoice}    ${c.score.toFixed(3)}   ${published[i]?.score?.toFixed(3) ?? "—"}${same ? "" : "  ≠"}${c.provisional ? "  (provisional)" : ""}`);
});
console.log(`\n  ${mismatches ? `${mismatches} donation(s) differ (time-dependent factors like open windows can shift between snapshots)` : "every published score reproduced exactly"}`);
