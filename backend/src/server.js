import express from "express";
import cors from "cors";
import multer from "multer";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import path from "node:path";
import { WebSocketServer } from "ws";
import { ethers } from "ethers";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import { chains, ROLES, roleKey, RELAYER_KEY, WATCHER_KEY, FAUCET_GAS_KEY, ROOT_DIR, RPC_A, RPC_B } from "./config.js";
import { authRouter, sessionMiddleware } from "./auth.js";
import { db, save, putFile, getFileByCid } from "./store.js";
import { Indexer } from "./indexer.js";
import { FORMULA_VERSION } from "./confidence.js";
import { Watcher } from "./watcher.js";
import { Relayer } from "./relayer.js";
import { reconcile } from "./reconcile.js";

const PORT = process.env.PORT || 4000;
const CATEGORY = ["Water", "Medical", "Education"];

const { depA, depB, providerA, providerB } = chains();
const app = express();
app.use(cors());
app.set("trust proxy", "loopback"); // the Vite proxy forwards from localhost; use X-Forwarded-For for rate limits
app.use(express.json({ limit: "2mb" }));
app.use(sessionMiddleware);
app.use("/api", authRouter({ depA, depB, providerA, providerB, funderKey: RELAYER_KEY, gasKey: FAUCET_GAS_KEY }));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const server = createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });
function broadcast(type, payload) {
  const msg = JSON.stringify({ type, payload, at: Date.now() });
  for (const client of wss.clients) if (client.readyState === 1) client.send(msg);
}

const indexer = new Indexer({ depA, depB, providerA, providerB });
const watcher = new Watcher({ indexer, depA, providerA, key: WATCHER_KEY, broadcast });
const relayer = new Relayer({ indexer, depA, depB, providerA, key: RELAYER_KEY, broadcast });
indexer.on("event", (ev) => broadcast("event", ev));
indexer.on("state", (s) => broadcast("state", s));

const ok = (res, data) => res.json(data);
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => bad(res, e.shortMessage || e.message, 500));

// ─────────────── config & read models ───────────────

app.get("/api/health", (_q, res) => ok(res, { ok: true, indexed: indexer.events.length }));

/// Everything the frontend needs to talk to the chains directly.
app.get("/api/config", (_q, res) => {
  const roles = Object.fromEntries(Object.entries(ROLES).map(([role, index]) => [role, { index, address: new ethers.Wallet(roleKey(role)).address }]));
  ok(res, { chainA: depA, chainB: depB, rpcA: RPC_A, rpcB: RPC_B, roles, categories: CATEGORY });
});

app.get("/api/state", (_q, res) => ok(res, indexer.state));
// Probabilistic evaluation chain for one donation: every stage, every factor, the formula version.
app.get("/api/confidence/:lotId", (req, res) => {
  const lot = indexer.state?.lots[Number(req.params.lotId)];
  if (!lot) return res.status(404).json({ error: "No such donation" });
  ok(res, { lotId: lot.id, formulaVersion: FORMULA_VERSION, ...lot.confidence });
});
app.get("/api/flow", (_q, res) => ok(res, indexer.flow()));
app.get("/api/events", (req, res) => ok(res, indexer.events.slice(-Number(req.query.limit || 100)).reverse()));
app.get("/api/watcher", (_q, res) => ok(res, watcher.findings));
app.get("/api/passport/:lotId", (req, res) => {
  const p = indexer.passport(Number(req.params.lotId));
  return p ? ok(res, p) : bad(res, "unknown lot", 404);
});

// ─────────────── content-addressed files (IPFS-compatible CIDs) ───────────────

app.post("/api/files", upload.single("file"), wrap(async (req, res) => {
  if (!req.file) return bad(res, "file required");
  ok(res, await putFile(req.file.buffer, { name: req.file.originalname, mime: req.file.mimetype }));
}));

app.get("/ipfs/:cid", (req, res) => {
  const f = getFileByCid(req.params.cid);
  if (!f) return bad(res, "not found", 404);
  res.type(f.meta?.mime || "application/octet-stream").send(f.buffer);
});

// ─────────────── invoices: vendor issues + signs, NGO submits on-chain ───────────────

const invoiceTypes = {
  Invoice: [
    { name: "vendor", type: "address" },
    { name: "ngoId", type: "uint256" },
    { name: "invoiceNo", type: "bytes32" },
    { name: "amount", type: "uint256" },
    { name: "date", type: "uint64" },
    { name: "category", type: "uint8" },
    { name: "fileHash", type: "bytes32" },
  ],
};
const domain = { name: "GlassVault", version: "1", chainId: depA.chainId, verifyingContract: depA.GlassVault.address };

/// Vendor publishes a signed invoice for an NGO. The signature is verified here only to keep the
/// inbox clean — the contract re-verifies it, so this endpoint cannot make a bad invoice pass.
app.post("/api/invoices", wrap(async (req, res) => {
  const { vendor, ngoId, invoiceNo, amount, date, category, fileHash, signature, lineItems } = req.body;
  const typed = { vendor, ngoId: BigInt(ngoId), invoiceNo: ethers.id(invoiceNo), amount: ethers.parseUnits(String(amount), 18), date: BigInt(date), category: Number(category), fileHash };
  const signer = ethers.verifyTypedData(domain, invoiceTypes, typed, signature);
  if (signer.toLowerCase() !== vendor.toLowerCase()) return bad(res, "signature does not match vendor");
  const id = db.nextInvoiceId++;
  db.invoices[id] = { id, vendor, ngoId: Number(ngoId), invoiceNo, amount: Number(amount), date: Number(date), category: Number(category), fileHash, signature, lineItems: lineItems ?? [], status: "signed", createdAt: Date.now() };
  save();
  ok(res, db.invoices[id]);
}));

app.get("/api/invoices", (req, res) => {
  let list = Object.values(db.invoices);
  if (req.query.ngoId !== undefined) list = list.filter((i) => i.ngoId === Number(req.query.ngoId));
  if (req.query.vendor) list = list.filter((i) => i.vendor.toLowerCase() === String(req.query.vendor).toLowerCase());
  // attach the receipt CID from the content-addressed file index
  ok(res, list.sort((a, b) => b.id - a.id).map((i) => ({ ...i, cid: db.files[i.fileHash]?.cid ?? null })));
});

app.post("/api/invoices/:id/status", (req, res) => {
  const inv = db.invoices[req.params.id];
  if (!inv) return bad(res, "unknown invoice", 404);
  Object.assign(inv, { status: req.body.status, txHash: req.body.txHash ?? inv.txHash });
  save();
  ok(res, inv);
});

// ─────────────── beneficiaries: QR cards → Merkle root ───────────────

/// Publishes a beneficiary batch: a Merkle tree of QR-card ADDRESSES built by the card issuer (field
/// partner) in the browser. Card keys are created and printed client-side; this server never generates,
/// receives or stores them. The root only counts once a registered field partner attests it on-chain.
app.post("/api/beneficiaries", (req, res) => {
  let tree;
  try {
    tree = StandardMerkleTree.load(req.body.dump);
    tree.validate(); // root and every node must follow from the leaves
  } catch {
    return bad(res, "dump must be a StandardMerkleTree dump");
  }
  const leaves = [...tree.entries()].map(([, v]) => v);
  if (JSON.stringify(req.body.dump?.leafEncoding) !== JSON.stringify(["address"])) return bad(res, 'leaf encoding must be ["address"]');
  if (!leaves.length || leaves.length > 1000) return bad(res, "a batch holds 1–1000 cards");
  if (!leaves.every(([a]) => ethers.isAddress(a))) return bad(res, "every leaf must be a card address");
  if (db.beneficiaryTrees[tree.root]) return bad(res, "batch already published", 409);
  const ngoId = req.body.ngoId === undefined || req.body.ngoId === null ? null : Number(req.body.ngoId);
  db.beneficiaryTrees[tree.root] = { root: tree.root, label: String(req.body.label ?? "").slice(0, 120), ngoId, count: leaves.length, dump: tree.dump(), createdAt: Date.now() };
  save();
  ok(res, { root: tree.root, count: leaves.length });
});

/// Public tree (card addresses only) — the field app computes Merkle proofs in the browser.
app.get("/api/beneficiaries/:root", (req, res) => {
  const t = db.beneficiaryTrees[req.params.root];
  return t ? ok(res, { root: t.root, count: t.count, label: t.label, dump: t.dump }) : bad(res, "unknown root", 404);
});

app.get("/api/beneficiaries", (req, res) => {
  const list = Object.values(db.beneficiaryTrees).filter((t) => req.query.ngoId === undefined || t.ngoId === Number(req.query.ngoId));
  ok(res, list.map(({ dump, ...rest }) => rest));
});

// ─────────────── report reconciler ───────────────

app.post("/api/reconcile", (req, res) => {
  if (!indexer.state) return bad(res, "indexer not ready", 503);
  ok(res, reconcile(indexer.state, req.body));
});

// ─────────────── red team: live attack steps + isolated benchmark ───────────────

let attackBusy = false;
app.post("/api/demo/attack/:step", wrap(async (req, res) => {
  if (attackBusy) return bad(res, "attack step already running", 409);
  attackBusy = true;
  try {
    const { runAttack } = await import("../scripts/attack.js");
    const out = await runAttack(req.params.step);
    broadcast("attack", out);
    ok(res, out);
  } finally {
    attackBusy = false;
  }
}));

let benchmarkRun = null;
app.post("/api/demo/benchmark", (_q, res) => {
  if (benchmarkRun) return ok(res, { status: "running" });
  broadcast("benchmark", { status: "running" });
  benchmarkRun = new Promise((resolve) => {
    const child = spawn("npx", ["hardhat", "run", "scripts/benchmark.js"], { cwd: path.join(ROOT_DIR, "contracts"), env: { ...process.env, BENCH_JSON: "1" }, shell: true });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.on("close", () => {
      const line = out.trim().split("\n").reverse().find((l) => l.startsWith("{"));
      const report = line ? JSON.parse(line) : { error: "benchmark failed" };
      broadcast("benchmark", { status: "done", report });
      benchmarkRun = null;
      resolve(report);
    });
  });
  ok(res, { status: "started" });
});

// JSON errors for anything thrown in a route (never an HTML stack trace)
app.use((err, _req, res, _next) => {
  if (err?.type === "entity.parse.failed") return bad(res, "Malformed JSON body");
  console.error("[api]", err?.shortMessage || err?.message || err);
  bad(res, "Internal error", 500);
});

// ─────────────── boot ───────────────

wss.on("connection", (socket) => {
  socket.send(JSON.stringify({ type: "state", payload: indexer.state, at: Date.now() }));
});

await indexer.start();
watcher.start();
relayer.start();
server.listen(PORT, () => console.log(`glassvault backend on http://localhost:${PORT} · indexed ${indexer.events.length} events`));
