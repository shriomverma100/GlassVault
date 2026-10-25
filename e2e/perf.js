// UI responsiveness probe: page-switch latency, scroll settle time, dropped frames and long tasks.
//   node e2e/perf.js            measure and compare against e2e/perf-baseline.json
//   node e2e/perf.js --save     measure and store the result as the new baseline
import { chromium } from "playwright-core";
import fs from "node:fs";

const BASE = process.env.BASE || "http://localhost:5173";
const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const BASELINE = new URL("./perf-baseline.json", import.meta.url);
const ROUTES = ["/donate", "/passport", "/ngo", "/watchtower", "/"];
const RUNS = 3;

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await ctx.addInitScript(() => {
  localStorage.setItem("gv-role", "donorPriya");
  window.__longTasks = [];
  new PerformanceObserver((l) => window.__longTasks.push(...l.getEntries().map((e) => e.duration))).observe({ type: "longtask", buffered: true });
});
const page = await ctx.newPage();
await page.goto(BASE + "/", { waitUntil: "networkidle" });
await page.waitForSelector("main");

// 1. click a header link → new <main> fully visible (opacity 1), measured inside the page
const nav = {};
for (const to of ROUTES) {
  const samples = [];
  for (let i = 0; i < RUNS; i++) {
    if (i > 0) {
      await page.goto(BASE + (to === "/" ? "/donate" : "/"), { waitUntil: "networkidle" });
      await page.waitForSelector("main");
    }
    samples.push(
      await page.evaluate(
        (to) =>
          new Promise((resolve) => {
            const old = document.querySelector("main");
            old.dataset.perfOld = "1";
            const t0 = performance.now();
            document.querySelector(`header a[href="${to}"]`).click();
            const check = () => {
              const m = document.querySelector("main:not([data-perf-old])");
              if (m && location.pathname === to && getComputedStyle(m).opacity === "1") return resolve(performance.now() - t0);
              if (performance.now() - t0 > 4000) return resolve(4000);
              requestAnimationFrame(check);
            };
            requestAnimationFrame(check);
          }),
        to,
      ),
    );
  }
  nav[to] = Math.round(median(samples));
}

// 2. scroll the long Explore page with real wheel input; record frames and how long it keeps moving
await page.goto(BASE + "/", { waitUntil: "networkidle" });
await page.waitForSelector("main");
await page.waitForTimeout(1000); // let the page finish its first paint/animations, as a reader would
await page.mouse.move(700, 450);
await page.evaluate(() => {
  window.scrollTo(0, 0);
  window.__longTasks = [];
  window.__frames = [];
  const loop = (t) => {
    window.__frames.push(t);
    if (!window.__stopFrames) requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
});
for (let i = 0; i < 12; i++) {
  await page.mouse.wheel(0, 120);
  await page.waitForTimeout(40);
}
const scroll = await page.evaluate(
  () =>
    new Promise((resolve) => {
      const t0 = performance.now();
      let last = scrollY;
      let still = 0;
      const check = () => {
        if (scrollY === last) still++;
        else (still = 0), (last = scrollY);
        if (still >= 5 || performance.now() - t0 > 5000) {
          window.__stopFrames = true;
          const f = window.__frames;
          const gaps = f.slice(1).map((t, i) => t - f[i]);
          // settle = time after the last wheel tick until the page stopped moving (5 still frames)
          const settle = Math.max(0, performance.now() - t0 - (5 * 1000) / 60);
          return resolve({
            settleMs: Math.round(settle),
            frames: gaps.length,
            droppedFrames: gaps.filter((g) => g > 25).length,
            worstFrameMs: Math.round(Math.max(...gaps)),
            longTasks: window.__longTasks.length,
            longestTaskMs: Math.round(Math.max(0, ...window.__longTasks)),
          });
        }
        requestAnimationFrame(check);
      };
      requestAnimationFrame(check);
    }),
);

await browser.close();

const dist = new URL("../frontend/dist/assets/", import.meta.url);
// JS the browser must download before the first page renders: the entry script + its modulepreloads
const html = new URL("../frontend/dist/index.html", import.meta.url);
const jsKb = fs.existsSync(html)
  ? Math.round(
      [...fs.readFileSync(html, "utf8").matchAll(/(?:src|href)="\/assets\/([^"]+\.js)"/g)]
        .map((m) => fs.statSync(new URL(m[1], dist)).size)
        .reduce((a, b) => a + b, 0) / 1024,
    )
  : null;

const result = { measuredAt: new Date().toISOString(), base: BASE, navMs: nav, scroll, bundleJsKb: jsKb };
const before = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, "utf8")) : null;

const row = (label, now, prev, unit = "ms") => console.log(`  ${label.padEnd(26)} ${String(now).padStart(6)} ${unit}${prev == null ? "" : `   (baseline ${prev} ${unit})`}`);
console.log(`\nGlassVault UI responsiveness · ${BASE}\n`);
console.log("  page switch (click → new page fully visible)");
for (const to of ROUTES) row(`    ${to}`, nav[to], before?.navMs?.[to]);
console.log("  scroll (12 wheel ticks on Explore)");
row("    keeps moving after input", scroll.settleMs, before?.scroll?.settleMs);
row("    dropped frames", scroll.droppedFrames, before?.scroll?.droppedFrames, `of ${scroll.frames}`);
row("    worst frame", scroll.worstFrameMs, before?.scroll?.worstFrameMs);
row("    long tasks (>50ms)", scroll.longTasks, before?.scroll?.longTasks, "");
row("  JS before first render", jsKb, before?.bundleJsKb, "KB");

if (process.argv.includes("--save") || !before) {
  fs.writeFileSync(BASELINE, JSON.stringify(result, null, 2) + "\n");
  console.log(`\n  saved as baseline → e2e/perf-baseline.json`);
}
