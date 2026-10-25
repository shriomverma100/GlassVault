// Seeds a fresh deployment with real on-chain history: NGOs, vendors, donations (incl. one bridged
// from chain B), and one payout taken all the way through the 4 roots. Every step is a real
// transaction; the backend must be running (it indexes, stores files and relays the bridge).
import { ethers } from "ethers";
import { setup, api, uploadFile, renderReceipt, signInvoice, advance, sleep, inr, CAT } from "./lib.js";
import { roleKey } from "../src/config.js";
import { createAccount, userByUsername } from "../src/accounts.js";

// Logins for the seeded history. LOCAL-CHAIN SEED DATA ONLY: the dev keys are public (Hardhat
// mnemonic) and so is this password — never reuse either on a real network.
const SEED_PASSWORD = "glassvault-local";
const SEED_ACCOUNTS = [
  ["priya", "donorPriya", "Donor", "Priya"],
  ["rahul", "donorRahul", "Donor", "Rahul"],
  ["tatacsr", "donorCSR", "Donor", "Tata CSR"],
  ["asha", "ngoAsha", "NGO", "Asha Foundation"],
  ["shadow", "ngoShadow", "NGO", "Shadow Trust"],
  ["bluewell", "vendorWater", "Vendor", "BlueWell Pumps"],
  ["medicare", "vendorMedical", "Vendor", "MediCare Supplies"],
  ["vidya", "vendorEducation", "Vendor", "Vidya Books"],
  ["quickfix", "vendorShell", "Vendor", "QuickFix Traders"],
  ["field", "fieldWorker", "Field", "Field worker"],
  ["watcher", "watcher", "Watcher", "Watcher"],
  ["paylink", "offrampAgent", "Vendor", "PayLink Fiat Agents"],
];

/// Idempotent: existing usernames are skipped. Keystores use the same scrypt cost as the browser.
async function seedAccounts() {
  console.log("\nlogins for the seeded roles (local chain only):");
  for (const [username, role, kind, displayName] of SEED_ACCOUNTS) {
    const wallet = new ethers.Wallet(roleKey(role));
    let note = "exists";
    if (!userByUsername(username)) {
      const keystore = await ethers.encryptKeystoreJson({ address: wallet.address, privateKey: wallet.privateKey }, SEED_PASSWORD, { scrypt: { N: 2 ** 15 } });
      const out = await createAccount({ username, password: SEED_PASSWORD, kind, displayName, address: wallet.address, keystore });
      note = out.error ? `skipped: ${out.error}` : "created";
    }
    console.log(`   ${username.padEnd(10)} ${kind.padEnd(8)} ${displayName.padEnd(18)} ${wallet.address}  ${note}`);
  }
  console.log(`   password for all: ${SEED_PASSWORD}`);
}

const ctx = setup();
const { vaultAs, tokenA, tokenB, gatewayB, address, providerA, depA } = ctx;
const log = (...a) => console.log("  ·", ...a);
const wait = (txp) => txp.then((tx) => tx.wait());
const inDays = async (d) => (await providerA.getBlock("latest")).timestamp + d * 86400;

const [nNgos] = await vaultAs("relayer").counts();
if (nNgos > 0n) {
  console.log("Already seeded — redeploy contracts (npm run deploy in contracts/) to start fresh.");
  await seedAccounts();
  process.exit(0);
}

console.log("1. funding wallets (dINR on both chains)");
const funded = ["ngoAsha", "ngoShadow", "vendorWater", "vendorMedical", "vendorEducation", "donorPriya", "donorRahul", "donorCSR", "watcher", "fieldWorker", "offrampAgent"];
for (const role of funded) {
  await wait(tokenA("relayer").mint(address(role), inr(2_000_000)));
  await wait(tokenA(role).approve(depA.GlassVault.address, ethers.MaxUint256));
}
for (const role of ["donorPriya", "donorRahul", "donorCSR"]) {
  await wait(tokenB("relayer").mint(address(role), inr(500_000)));
  await wait(tokenB(role).approve(ctx.depB.BridgeGateway.address, ethers.MaxUint256));
}

console.log("2. NGOs post bonds, vendors post stakes");
await wait(vaultAs("ngoAsha").registerNGO("Asha Foundation"));
await wait(vaultAs("ngoShadow").registerNGO("Shadow Trust"));
await wait(vaultAs("vendorWater").registerVendor(CAT.Water, ethers.id("GSTIN 27AABCB1234F1Z5 · BlueWell Pumps")));
await wait(vaultAs("vendorMedical").registerVendor(CAT.Medical, ethers.id("GSTIN 07AACCM5678K1Z2 · MediCare Supplies")));
await wait(vaultAs("vendorEducation").registerVendor(CAT.Education, ethers.id("GSTIN 29AADCV9012L1Z8 · Vidya Books")));
await wait(vaultAs("offrampAgent").registerOffRamp(CAT.Water, ethers.id("RBI PA licence · PayLink Fiat Agents")));
log("PayLink Fiat Agents registered as a fiat off-ramp (Water)");

console.log("3. donations (purpose-tagged lots)");
const donations = [
  ["donorPriya", 0, CAT.Water, 50_000],
  ["donorRahul", 0, CAT.Water, 30_000],
  ["donorCSR", 0, CAT.Medical, 100_000],
  ["donorRahul", 0, CAT.Education, 20_000],
  ["donorCSR", 1, CAT.Water, 60_000],
  ["donorPriya", 1, CAT.Water, 25_000],
];
for (const [role, ngo, cat, amt] of donations) {
  await wait(vaultAs(role).donate(ngo, cat, inr(amt), await inDays(30)));
  log(`${role} → NGO ${ngo} · ₹${amt.toLocaleString("en-IN")}`);
}

console.log("4. cross-chain donation from chain B (relayed by the backend)");
const [, lotsBefore] = await vaultAs("relayer").counts();
await wait(gatewayB("donorPriya").sendDonation(0, CAT.Medical, inr(15_000), await inDays(30), depA.chainId));
for (let i = 0; i < 30; i++) {
  const [, lots] = await vaultAs("relayer").counts();
  if (lots > lotsBefore) break;
  await sleep(500);
}
log("bridged lot delivered on chain A");

console.log("4b. multi-hop donation: 0.25 ETH on chain B → swapped to dINR → bridged → tagged lot on chain A");
const dexB = new ethers.Contract(ctx.depB.MockDEX.address, ctx.depB.MockDEX.abi, ctx.providerB);
const ethIn = ethers.parseEther("0.25");
const quoted = await dexB.quote(ethIn);
const [, lotsBeforeSwap] = await vaultAs("relayer").counts();
await wait(gatewayB("donorRahul").sendDonationWithSwap(ctx.depB.MockDEX.address, 0, CAT.Water, await inDays(30), depA.chainId, quoted, { value: ethIn }));
log(`hop 1 · Rahul swapped 0.25 ETH → ₹${Number(ethers.formatUnits(quoted, 18)).toLocaleString("en-IN")} dINR on chain B and locked it in the bridge`);
let swappedLot = null;
for (let i = 0; i < 30 && swappedLot === null; i++) {
  const [, lots] = await vaultAs("relayer").counts();
  if (lots > lotsBeforeSwap) swappedLot = Number(lots) - 1;
  else await sleep(500);
}
if (swappedLot === null) throw new Error("swapped donation was not relayed");
log(`hop 2 · relayer delivered it to chain A as lot #${swappedLot} (donor + purpose tag kept)`);

console.log("5. full 4-root payout: invoice → window → release 70% → deliveries → final 30%");
const date = Math.floor(Date.now() / 1000) - 3 * 86400;
const items = [{ qty: 4, name: "Hand pump (India Mark II)", price: 7_500 }, { qty: 10, name: "GI pipe 3m", price: 1_000 }];
const png = await renderReceipt({ seed: "seed-bw-1042", vendorName: "BlueWell Pumps", invoiceNo: "BW-1042", date, items, total: 40_000 });
const file = await uploadFile(png, "BW-1042.png");
const fields = { vendor: address("vendorWater"), ngoId: 0, invoiceNo: "BW-1042", amount: 40_000, date, category: CAT.Water, fileHash: file.fileHash };
const { typed, signature } = await signInvoice(ctx, "vendorWater", fields);
const invoice = await api("/api/invoices", { ...fields, signature, lineItems: items });

const batch = await api("/api/beneficiaries", { count: 3, label: "Wadgaon village handpumps", ngoId: 0 });
await wait(vaultAs("ngoAsha").requestPayout(typed, signature, [{ lotId: 0, amount: inr(30_000) }, { lotId: 1, amount: inr(10_000) }], batch.root, 3));
await api(`/api/invoices/${invoice.id}/status`, { status: "submitted" });
log("payout #0 requested · challenge window open");

// off-ramp payout from the swapped lot: PayLink pays a local hardware shop in rupees, off-chain
const plItems = [{ qty: 8, name: "Handpump spares kit (cash to Gram Jal Hardware)", price: 2_500 }];
const plPng = await renderReceipt({ seed: "seed-pl-5521", vendorName: "PayLink Fiat Agents", invoiceNo: "PL-5521", date, items: plItems, total: 20_000 });
const plFile = await uploadFile(plPng, "PL-5521.png");
const plFields = { vendor: address("offrampAgent"), ngoId: 0, invoiceNo: "PL-5521", amount: 20_000, date, category: CAT.Water, fileHash: plFile.fileHash };
const pl = await signInvoice(ctx, "offrampAgent", plFields);
const plInvoice = await api("/api/invoices", { ...plFields, signature: pl.signature, lineItems: plItems });
const plBatch = await api("/api/beneficiaries", { count: 2, label: "Wadgaon handpump repairs", ngoId: 0 });
await wait(vaultAs("ngoAsha").requestPayout(pl.typed, pl.signature, [{ lotId: swappedLot, amount: inr(20_000) }], plBatch.root, 2));
await api(`/api/invoices/${plInvoice.id}/status`, { status: "submitted" });
log(`hop 3 · payout #1 requested from lot #${swappedLot} to off-ramp PayLink (PL-5521, ₹20,000)`);

await advance(providerA, Number(await vaultAs("relayer").challengeWindow()) + 1);
await wait(vaultAs("fieldWorker").release(0));
log("window closed · 70% released to BlueWell Pumps");
await wait(vaultAs("fieldWorker").release(1));
log("hop 4 · payout #1: 70% (₹14,000) released to PayLink on-chain");

const { StandardMerkleTree } = await import("@openzeppelin/merkle-tree");
const tree = StandardMerkleTree.load((await api(`/api/beneficiaries/${batch.root}`)).dump);
for (const card of batch.cards) {
  const proof = tree.getProof([card.commitment]);
  await wait(vaultAs("fieldWorker").confirmDelivery(0, card.secret, proof));
}
log("3/3 beneficiaries confirmed by QR · final 30% released · Proof-of-Impact minted");

// off-chain fiat leg: PayLink pays the shop by bank transfer, then signs what it paid (EIP-712)
const settlement = {
  payoutId: 1,
  fiatAmount: inr(20_000),
  bankRefHash: ethers.id("UTR-SBIN-2026-0042"),
  payeeHash: ethers.id("Gram Jal Hardware, Wadgaon"),
  paidAt: (await providerA.getBlock("latest")).timestamp,
};
const fiatDomain = { name: "GlassVault", version: "1", chainId: depA.chainId, verifyingContract: depA.GlassVault.address };
const fiatTypes = {
  FiatSettlement: [
    { name: "payoutId", type: "uint256" },
    { name: "fiatAmount", type: "uint256" },
    { name: "bankRefHash", type: "bytes32" },
    { name: "payeeHash", type: "bytes32" },
    { name: "paidAt", type: "uint64" },
  ],
};
const fiatSig = await new ethers.Wallet(roleKey("offrampAgent")).signTypedData(fiatDomain, fiatTypes, settlement);
await wait(vaultAs("offrampAgent").attestFiat(settlement, fiatSig));
log("hop 5 · PayLink attested ₹20,000 paid by bank (UTR hash) to Gram Jal Hardware (payee hash)");
const plTree = StandardMerkleTree.load((await api(`/api/beneficiaries/${plBatch.root}`)).dump);
for (const card of plBatch.cards) await wait(vaultAs("fieldWorker").confirmDelivery(1, card.secret, plTree.getProof([card.commitment])));
log("hop 6 · 2/2 beneficiaries confirmed · fiat + delivery proven → final 30% paid · impact verified");

console.log("6. a second payout left OPEN for the live demo (Medical, window running)");
const items2 = [{ qty: 200, name: "Insulin vial 10ml", price: 250 }];
const png2 = await renderReceipt({ seed: "seed-mc-311", vendorName: "MediCare Supplies", invoiceNo: "MC-311", date, items: items2, total: 50_000 });
const file2 = await uploadFile(png2, "MC-311.png");
const f2 = { vendor: address("vendorMedical"), ngoId: 0, invoiceNo: "MC-311", amount: 50_000, date, category: CAT.Medical, fileHash: file2.fileHash };
const s2 = await signInvoice(ctx, "vendorMedical", f2);
await api("/api/invoices", { ...f2, signature: s2.signature, lineItems: items2 });
const batch2 = await api("/api/beneficiaries", { count: 5, label: "PHC Kamptee diabetic patients", ngoId: 0 });
console.log("   (invoice MC-311 is signed and waiting in Asha Foundation's inbox)");
console.log(`   beneficiary card secrets for batch ${batch2.root.slice(0, 10)}… :`);
batch2.cards.forEach((c) => console.log(`     card ${c.n}: ${c.secret}`));

await seedAccounts();
console.log("\n✔ seeded. Open the dashboard.");
