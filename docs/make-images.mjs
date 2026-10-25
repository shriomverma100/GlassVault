// Curates README screenshots from the rehearsal (demo/shots) and e2e runs into docs/images/.
//   node docs/make-images.mjs
import fs from "node:fs";
import { createRequire } from "node:module";

const { Jimp } = createRequire(new URL("../backend/package.json", import.meta.url))("jimp");
const src = (p) => new URL(`../${p}`, import.meta.url);
const out = (n) => new URL(`./images/${n}`, import.meta.url);

// [source, output, crop top, crop height] — tall full-page captures are cut to their key region
const SHOTS = [
  ["demo/shots/act01-landing.png", "landing.png"],
  ["e2e/shots/explore-visuals.png", "fund-flow.png", 1290, 930],
  ["demo/shots/act02-metamask-eth-donation.png", "metamask-eth-donation.png"],
  ["demo/shots/act03-donate.png", "donate.png"],
  ["demo/shots/act04-vendor-invoice.png", "vendor-invoice.png"],
  ["demo/shots/act05-cards.png", "field-cards.png"],
  ["demo/shots/act06-prepare-payout.png", "prepare-payout.png"],
  ["demo/shots/act08-passport-confidence.png", "evaluation-chain.png", 1040, 560],
  ["demo/shots/act09-multihop-journey.png", "multihop-journey.png", 120, 1200],
  ["demo/shots/act12-freeze.png", "freeze-frame.png"],
  ["demo/shots/act13-reconciler.png", "reconciler.png"],
  ["demo/shots/act14-benchmark.png", "benchmark.png"],
  ["e2e/shots/tour-donor-step3.png", "guided-tour.png"],
];
for (const [from, to, top, height] of SHOTS) {
  if (!fs.existsSync(src(from))) {
    console.log(`skip ${from} (not found)`);
    continue;
  }
  const img = await Jimp.read(fs.readFileSync(src(from)));
  if (top !== undefined) img.crop({ x: 0, y: top, w: img.bitmap.width, h: Math.min(height, img.bitmap.height - top) });
  if (img.bitmap.width > 1440) img.resize({ w: 1440 });
  fs.writeFileSync(out(to), await img.getBuffer("image/png"));
  console.log(`${to.padEnd(28)} ${img.bitmap.width}×${img.bitmap.height}`);
}
