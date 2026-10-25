// Builds the demo upload kit: receipt photos the vendor uploads during the live walkthrough.
//   node demo/make-kit.mjs
import fs from "node:fs";
import { renderReceipt } from "../backend/scripts/lib.js";

const out = new URL("./kit/", import.meta.url);
fs.mkdirSync(out, { recursive: true });
const date = Math.floor(Date.now() / 1000) - 86400;
const items = [
  { qty: 2, name: "Hand pump (India Mark II)", price: 7_500 },
  { qty: 5, name: "GI pipe 3m", price: 1_000 },
];

// 1. the genuine receipt for the honest payout
fs.writeFileSync(new URL("BW-2001-handpumps.png", out), await renderReceipt({ seed: "demo-bw-2001", vendorName: "BlueWell Pumps", invoiceNo: "BW-2001", date, items, total: 20_000 }));
// 2. the SAME photo re-scanned (new lighting jitter) and re-numbered: the watcher's image check catches it
fs.writeFileSync(new URL("BW-2001-rescan-as-BW-2077.png", out), await renderReceipt({ seed: "demo-bw-2001", vendorName: "BlueWell Pumps", invoiceNo: "BW-2077", date, items, total: 20_000, jitter: 7 }));
// 3. an unrelated genuine receipt (Education) for a second honest invoice
fs.writeFileSync(
  new URL("VB-310-textbooks.png", out),
  await renderReceipt({ seed: "demo-vb-310", vendorName: "Vidya Books", invoiceNo: "VB-310", date, items: [{ qty: 40, name: "Class 6 science textbook", price: 250 }], total: 10_000 }),
);
console.log("demo kit written to demo/kit/:", fs.readdirSync(out).join(", "));
