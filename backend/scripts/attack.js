// Live red-team attack on the running dashboard chain. "Shadow Trust" (NGO 1) colludes with a shell
// vendor and tries three frauds. Every step is a real transaction; detection is done by the contract
// and by the independent watcher bot — this script never reports fraud itself.
//
//   node scripts/attack.js            → run all steps
//   node scripts/attack.js <step>     → run one step (shell | doctored | duplicate | forged | verdict)
import { ethers } from "ethers";
import { pathToFileURL } from "node:url";
import { setup, api, uploadFile, renderReceipt, signInvoice, advance, inr, CAT, issueBatch } from "./lib.js";

const SHADOW = 1;

export async function runAttack(step, ctx = setup()) {
  const { vaultAs, tokenA, address, depA, providerA } = ctx;
  const vault = vaultAs("ngoShadow");
  const date = Math.floor(Date.now() / 1000) - 2 * 86400;
  const lots = (await api("/api/state")).lots.filter((l) => l.ngoId === SHADOW && l.category === "Water" && l.remaining > 0);
  const lot = lots.sort((a, b) => b.remaining - a.remaining)[0];
  const send = async (txp) => (await txp).wait();

  switch (step) {
    case "shell": {
      // a shell vendor stakes and registers — legal on its own
      await send(tokenA("relayer").mint(address("vendorShell"), inr(100_000)));
      await send(tokenA("vendorShell").approve(depA.GlassVault.address, ethers.MaxUint256));
      await send(vaultAs("vendorShell").registerVendor(CAT.Water, ethers.id("QuickFix Traders")));
      return { step, note: "Shell vendor 'QuickFix Traders' registered with a ₹5,000 stake" };
    }
    case "doctored": {
      // re-uses BlueWell's real BW-1042 photo with the number and total edited; the shell vendor signs it.
      // Signature, nullifier and budget all pass on-chain — only the watcher's image check can catch it.
      const png = await renderReceipt({
        seed: "seed-bw-1042",
        vendorName: "BlueWell Pumps",
        invoiceNo: "QF-0077",
        date,
        items: [{ qty: 4, name: "Hand pump (India Mark II)", price: 7_500 }, { qty: 15, name: "GI pipe 3m", price: 1_000 }],
        total: 45_000,
        jitter: 6,
      });
      const file = await uploadFile(png, "QF-0077.png");
      const fields = { vendor: address("vendorShell"), ngoId: SHADOW, invoiceNo: "QF-0077", amount: Math.min(45_000, lot.remaining), date, category: CAT.Water, fileHash: file.fileHash };
      const { typed, signature } = await signInvoice(ctx, "vendorShell", fields);
      await api("/api/invoices", { ...fields, signature });
      const batch = await issueBatch(ctx, { ngoId: SHADOW, count: 2, label: "Shadow Trust 'beneficiaries'" });
      await send(vault.requestPayout(typed, signature, [{ lotId: lot.id, amount: inr(fields.amount) }], batch.root, 2));
      return { step, note: `Doctored photo submitted as QF-0077 (₹${fields.amount.toLocaleString("en-IN")}) — passes on-chain checks, watcher should challenge` };
    }
    case "duplicate": {
      // the same BW-1042 invoice re-scanned and claimed again by a different NGO
      const png = await renderReceipt({ seed: "seed-bw-1042", vendorName: "BlueWell Pumps", invoiceNo: "BW-1042", date: Math.floor(Date.now() / 1000) - 3 * 86400, items: [{ qty: 4, name: "Hand pump (India Mark II)", price: 7_500 }, { qty: 10, name: "GI pipe 3m", price: 1_000 }], total: 40_000, jitter: 9 });
      const file = await uploadFile(png, "BW-1042-rescan.png");
      const original = (await api("/api/invoices")).find((i) => i.invoiceNo === "BW-1042");
      const fields = { vendor: original.vendor, ngoId: SHADOW, invoiceNo: "BW-1042", amount: 40_000, date: original.date, category: CAT.Water, fileHash: file.fileHash };
      // NGO cannot get BlueWell to sign again, so it signs in BlueWell's name too — two lies in one
      const { typed, signature } = await signInvoice(ctx, "ngoShadow", fields);
      await send(vault.requestPayout(typed, signature, [{ lotId: lot.id, amount: inr(Math.min(40_000, lot.remaining)) }], ethers.id("root"), 1));
      return { step, note: "Re-scanned BW-1042 resubmitted by Shadow Trust → invoice nullifier collision" };
    }
    case "forged": {
      const fields = { vendor: address("vendorWater"), ngoId: SHADOW, invoiceNo: "BW-9999", amount: 9_999, date, category: CAT.Water, fileHash: ethers.id("no-file") };
      const { typed, signature } = await signInvoice(ctx, "ngoShadow", fields);
      await send(vault.requestPayout(typed, signature, [{ lotId: lot.id, amount: inr(9_999) }], ethers.id("root"), 1));
      return { step, note: "Invoice forged in BlueWell's name → signature check fails → second flag" };
    }
    case "verdict": {
      // donors whose money funds the challenged payout vote; then the court resolves on-chain
      const state = await api("/api/state");
      const p = state.payouts.find((x) => x.ngoId === SHADOW && x.status === "Challenged");
      if (!p) return { step, note: "No challenged payout to resolve" };
      const roles = ["donorPriya", "donorRahul", "donorCSR"];
      for (const sh of p.shares) {
        const donor = state.lots[sh.lotId].donor.toLowerCase();
        const role = roles.find((r) => address(r).toLowerCase() === donor);
        if (role && !(await vault.hasVoted(p.id, address(role)))) await send(vaultAs(role).vote(p.id, true));
      }
      await advance(providerA, Number(await vault.challengeWindow()) + 1);
      await send(vaultAs("watcher").resolve(p.id));
      return { step, note: `Donors upheld the challenge on payout #${p.id} → NGO bond + vendor stake slashed to the watcher` };
    }
    default:
      throw new Error(`unknown step ${step}`);
  }
}

export const ATTACK_STEPS = ["shell", "doctored", "duplicate", "forged", "verdict"];

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const steps = process.argv[2] ? [process.argv[2]] : ATTACK_STEPS;
  for (const s of steps) {
    const res = await runAttack(s);
    console.log(`  · [${s}] ${res.note}`);
    if (s === "doctored") await new Promise((r) => setTimeout(r, 4000)); // give the watcher time to challenge
  }
}
