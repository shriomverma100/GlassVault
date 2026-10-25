// Red-team benchmark: 100 receipts, 30% fraudulent, run against freshly deployed GlassVault contracts
// on an isolated in-process Hardhat chain (real EVM execution, live dashboard untouched).
//
// Each fraudulent receipt is evaluated from a clean snapshot (then reverted) so one NGO's freeze
// doesn't hide the next attack — we measure per-receipt detection. Genuine receipts are committed
// in order, so duplicates really collide with history.
//
//   npx hardhat run scripts/benchmark.js            → human-readable report
//   BENCH_JSON=1 npx hardhat run scripts/benchmark.js → JSON (used by the backend /api/demo/benchmark)
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { ethers, network } = require("hardhat");
const { StandardMerkleTree } = require("@openzeppelin/merkle-tree");

const JSON_OUT = !!process.env.BENCH_JSON;
const say = (...a) => !JSON_OUT && console.log(...a);
const backend = (f) => import(pathToFileURL(path.join(__dirname, "..", "..", "backend", f)).href);
const inr = (n) => ethers.parseUnits(String(n), 18);
const NEAR_DUP = 14; // must match backend/src/watcher.js

function prng(seed) {
  let s = seed % 2147483647 || 1;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

async function main() {
  const t0 = Date.now();
  const { renderReceipt } = await backend("scripts/lib.js");
  const { differenceHash, hamming } = await backend("src/store.js");
  const [deployer, ngo, vendor, colluder, donor] = await ethers.getSigners();
  const shell = ethers.Wallet.createRandom();

  const dinr = await ethers.deployContract("DINR");
  const gw = await ethers.deployContract("BridgeGateway", [await dinr.getAddress(), deployer.address]);
  const vault = await ethers.deployContract("GlassVault", [await dinr.getAddress(), 60, await gw.getAddress()]);
  for (const s of [ngo, vendor, colluder, donor]) {
    await dinr.mint(s.address, inr(100_000_000));
    await dinr.connect(s).approve(await vault.getAddress(), ethers.MaxUint256);
  }
  await vault.connect(ngo).registerNGO("Benchmark NGO");
  await vault.connect(vendor).registerVendor(0, ethers.id("honest vendor"));
  await vault.connect(colluder).registerVendor(0, ethers.id("colluding vendor")); // registered + staked, signs fake invoices
  const deadline = (await ethers.provider.getBlock("latest")).timestamp + 365 * 86400;
  await vault.connect(donor).donate(0, 0, inr(50_000_000), deadline); // lot 0

  const leaf = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["bytes32"], [ethers.id("card")]));
  const root = StandardMerkleTree.of([[leaf]], ["bytes32"]).root;

  const { chainId } = await ethers.provider.getNetwork();
  const domain = { name: "GlassVault", version: "1", chainId, verifyingContract: await vault.getAddress() };
  const types = { Invoice: [["vendor", "address"], ["ngoId", "uint256"], ["invoiceNo", "bytes32"], ["amount", "uint256"], ["date", "uint64"], ["category", "uint8"], ["fileHash", "bytes32"]].map(([name, type]) => ({ name, type })) };
  const date = Math.floor(Date.now() / 1000) - 86400;

  // ── build the 100-receipt batch ──
  const r = prng(42);
  const genuine = Array.from({ length: 70 }, (_, i) => ({
    kind: "genuine",
    seed: `g-${i}`,
    no: `BW-${2000 + i}`,
    amount: 1_000 + Math.floor(r() * 90_000),
  }));
  const attacks = [
    ...Array.from({ length: 8 }, (_, i) => ({ kind: "duplicate-rescan", of: i * 7 })),
    ...Array.from({ length: 8 }, (_, i) => ({ kind: "altered-amount", of: i * 8 + 3 })),
    ...Array.from({ length: 5 }, (_, i) => ({ kind: "ngo-forged-signature", of: i * 9 + 5 })),
    ...Array.from({ length: 4 }, (_, i) => ({ kind: "fake-vendor", of: i * 11 + 1 })),
    ...Array.from({ length: 5 }, (_, i) => ({ kind: "doctored-photo-colluding-vendor", of: i * 13 + 2 })),
  ];
  // interleave: every attack lands after the genuine receipt it copies
  const order = [];
  genuine.forEach((g, i) => {
    order.push(g);
    attacks.filter((a) => a.of === i).forEach((a) => order.push(a));
  });

  const acceptedHashes = []; // dHashes of accepted receipt photos (the watcher's memory)
  const results = [];
  let lastFlags = 0n;

  for (const item of order) {
    const base = item.kind === "genuine" ? item : genuine[item.of];
    let signer = vendor, vendorAddr = vendor.address, fields, photo;

    if (item.kind === "genuine") {
      photo = await renderReceipt({ seed: base.seed, vendorName: "BlueWell Pumps", invoiceNo: base.no, date, items: [{ qty: 1, name: "Supplies", price: base.amount }], total: base.amount });
      fields = { invoiceNo: base.no, amount: base.amount };
    } else if (item.kind === "duplicate-rescan") {
      photo = await renderReceipt({ seed: base.seed, vendorName: "BlueWell Pumps", invoiceNo: base.no, date, items: [{ qty: 1, name: "Supplies", price: base.amount }], total: base.amount, jitter: 7 });
      fields = { invoiceNo: base.no, amount: base.amount };
    } else if (item.kind === "altered-amount" || item.kind === "ngo-forged-signature") {
      photo = await renderReceipt({ seed: `${base.seed}-x`, vendorName: "BlueWell Pumps", invoiceNo: `${base.no}A`, date, items: [{ qty: 1, name: "Supplies", price: base.amount * 3 }], total: base.amount * 3 });
      fields = { invoiceNo: `${base.no}A`, amount: base.amount * 3 };
      if (item.kind === "ngo-forged-signature") signer = ngo;
    } else if (item.kind === "fake-vendor") {
      photo = await renderReceipt({ seed: `shell-${item.of}`, vendorName: "QuickFix Traders", invoiceNo: `QF-${item.of}`, date, items: [{ qty: 1, name: "Repairs", price: 25_000 }], total: 25_000 });
      fields = { invoiceNo: `QF-${item.of}`, amount: 25_000 };
      signer = shell;
      vendorAddr = shell.address;
    } else {
      // same photo as a genuine receipt, invoice number + amount edited, signed by a staked colluding vendor
      photo = await renderReceipt({ seed: base.seed, vendorName: "BlueWell Pumps", invoiceNo: `${base.no}-B`, date, items: [{ qty: 1, name: "Supplies", price: base.amount + 5_000 }], total: base.amount + 5_000, jitter: 5 });
      fields = { invoiceNo: `${base.no}-B`, amount: base.amount + 5_000 };
      signer = colluder;
      vendorAddr = colluder.address;
    }

    const inv = { vendor: vendorAddr, ngoId: 0, invoiceNo: ethers.id(fields.invoiceNo), amount: inr(fields.amount), date, category: 0, fileHash: ethers.keccak256(photo) };
    let sig;
    if (item.kind === "altered-amount") {
      // vendor signed the ORIGINAL amount; NGO edits the amount afterwards
      sig = await vendor.signTypedData(domain, types, { ...inv, amount: inr(base.amount) });
    } else {
      sig = await signer.signTypedData(domain, types, inv);
    }

    const dh = await differenceHash(photo);
    const snap = item.kind === "genuine" ? null : await network.provider.send("evm_snapshot");
    const rc = await (await vault.connect(ngo).requestPayout(inv, sig, [{ lotId: 0, amount: inv.amount }], root, 1)).wait();
    const flagged = rc.logs.some((l) => vault.interface.parseLog(l)?.name === "FraudFlagged");
    const flagEv = rc.logs.map((l) => vault.interface.parseLog(l)).find((p) => p?.name === "FraudFlagged");
    const nearDup = !flagged && acceptedHashes.some((h) => hamming(h, dh) <= NEAR_DUP);

    const caughtBy = flagged ? `on-chain:${["DuplicateInvoice", "ForgedSignature", "OutOfCategory", "OverBudget", "AmountMismatch", "UnregisteredVendor"][Number(flagEv.args.reason)]}` : nearDup ? "watcher:near-duplicate-photo" : null;
    results.push({ kind: item.kind, fraud: item.kind !== "genuine", caught: !!caughtBy, caughtBy });

    if (snap) await network.provider.send("evm_revert", [snap]);
    else if (!caughtBy) acceptedHashes.push(dh);
    void lastFlags;
  }

  // ── live finale on the same chain: two frauds in a row freeze the NGO ──
  const g0 = genuine[0];
  const reuse = { vendor: vendor.address, ngoId: 0, invoiceNo: ethers.id(g0.no), amount: inr(g0.amount), date, category: 0, fileHash: ethers.id("rescan") };
  await vault.connect(ngo).requestPayout(reuse, await vendor.signTypedData(domain, types, reuse), [{ lotId: 0, amount: reuse.amount }], root, 1);
  const forged = { ...reuse, invoiceNo: ethers.id("FORGED-1"), amount: inr(99_999) };
  await vault.connect(ngo).requestPayout(forged, await ngo.signTypedData(domain, types, forged), [{ lotId: 0, amount: forged.amount }], root, 1);
  const frozen = (await vault.ngo(0)).frozen;

  // ── metrics ──
  const tp = results.filter((x) => x.fraud && x.caught).length;
  const fn = results.filter((x) => x.fraud && !x.caught).length;
  const fp = results.filter((x) => !x.fraud && x.caught).length;
  const tn = results.filter((x) => !x.fraud && !x.caught).length;
  const byKind = {};
  for (const x of results) {
    const k = (byKind[x.kind] ??= { total: 0, caught: 0, by: {} });
    k.total++;
    if (x.caught) {
      k.caught++;
      k.by[x.caughtBy] = (k.by[x.caughtBy] ?? 0) + 1;
    }
  }
  const report = {
    receipts: results.length,
    fraudulent: tp + fn,
    genuine: fp + tn,
    truePositives: tp,
    falseNegatives: fn,
    falsePositives: fp,
    trueNegatives: tn,
    recall: tp / (tp + fn),
    precision: tp + fp ? tp / (tp + fp) : 1,
    byKind,
    freezeAfterTwoFrauds: frozen,
    seconds: (Date.now() - t0) / 1000,
  };

  if (JSON_OUT) return console.log(JSON.stringify(report));
  say(`\nGlassVault red-team benchmark — ${report.receipts} receipts (${report.fraudulent} fraudulent)\n`);
  for (const [k, v] of Object.entries(byKind)) say(`  ${k.padEnd(34)} ${String(v.caught).padStart(3)}/${v.total}  ${Object.entries(v.by).map(([b, n]) => `${b}×${n}`).join(", ")}`);
  say(`\n  fraud caught (recall)      ${tp}/${tp + fn}  = ${(report.recall * 100).toFixed(1)}%`);
  say(`  false alarms on genuine    ${fp}/${fp + tn}`);
  say(`  precision                  ${(report.precision * 100).toFixed(1)}%`);
  say(`  2 frauds in a row → NGO frozen: ${frozen ? "YES" : "NO"}`);
  say(`  ran in ${report.seconds.toFixed(1)}s\n`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
