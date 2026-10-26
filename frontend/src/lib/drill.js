// The judges' drill as an in-app guide: every role, every page, every upload, in order.
// Each step: { id, part, role (demo username | "guest" | "anyone" | "terminal"), route, target (data-tour id),
//   title, do: [line | { text, copy }], upload: [file in /drill/], expect, why, check(ctx) → bool }
// `check` reads live chain state so the panel ticks a step off by itself; Next always works without it.
// Steps mirror demo/JUDGES-DRILL.md and e2e/demo-rehearsal.js.

const same = (a, b) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
const fresh = (list, from) => (list ?? []).slice(from ?? 0);

/// Remembers which payout belongs to which part of the drill (the first match after the drill started).
function payoutOf(ctx, key, test) {
  if (ctx.mem[key] != null) return ctx.state.payouts[ctx.mem[key]];
  const p = fresh(ctx.state.payouts, ctx.base.payouts).find(test);
  if (p) ctx.mem[key] = p.id;
  return p;
}

export const DRILL_FILES = {
  original: { file: "BW-2001-handpumps.png", label: "Genuine receipt BW-2001" },
  rescan: { file: "BW-2001-rescan-as-BW-2077.png", label: "Re-scanned copy (the fraud)" },
};

export const DRILL = [
  {
    id: "intro", part: "Start", role: "anyone", route: "/", target: null,
    title: "The judges’ drill — every role, start to finish",
    do: [
      "Before the judges: reset the platform in a terminal — `npm run stop`, then `npm run start:prod` (≈1 min).",
      "Each step tells you **who** to be, **where** to go and **what** to click. “Sign in as …” switches account in one click.",
      "**Enter** or → = next step · ← = back · Esc = close (your place is kept).",
    ],
    expect: "Part A is the honest water project (steps 2–10). Part B is the attack and how the contract defeats it (11–19). Then verify it yourself.",
    why: "One continuous story: 50 ETH for ‘water’ becomes proven impact — and a cheating NGO gets caught and frozen without an auditor.",
  },
  {
    id: "landing", part: "A · Honest flow", role: "guest", route: "/", target: "landing-how",
    title: "The public picture",
    do: ["Point at the four steps: **01 Donate → 02 Escrow → 03 Invoice → 70% → 04 Cards → 30%**, each with a live number.", "Scroll: live ticker → money pipeline → Sankey → NGO cards."],
    expect: "Live totals read from the chain — no login needed.",
    why: "Transparency must not need an account: anyone can audit the whole ledger.",
  },
  {
    id: "metamask", part: "A · Honest flow", role: "guest", route: "/login", target: null, optional: true,
    title: "Optional · donate ETH with MetaMask (swap + bridge)",
    do: [
      "Click **Continue with MetaMask** → approve “add chain” → sign the message (free).",
      "Sign up as **Donor**, any name and username.",
      "**Donate** → Asha Foundation → **Water** → **Chain B · via bridge** → **Pay in ETH · swapped** → amount:",
      { text: "0.05", copy: "0.05" },
      "Wait for “Swaps to about ₹10,000” → **Swap, bridge and donate** → confirm in MetaMask.",
    ],
    expect: "The passport shows: ETH → swapped to ₹10,000 → bridged → locked, still tagged Water.",
    why: "The PS example: funds are swapped and bridged, yet stay traceable and earmarked. No MetaMask? Skip — step 10 shows the same path.",
  },
  {
    id: "donate", part: "A · Honest flow", role: "priya", route: "/donate", target: "donate-ngo",
    title: "Priya gives ₹25,000 for Water — with a fallback NGO",
    do: ["Click **Asha Foundation** → **Water**.", "Amount:", { text: "25000", copy: "25000" }, "**Send it to another NGO** → **Shadow Trust** (the fallback).", "Click **Donate**."],
    expect: "Passport opens: “Locked in escrow · Water”. The money is in the contract, not with Asha.",
    why: "Purpose-bound allocation: the contract stores the earmark. The fallback is a dead-man switch — if Asha fails, nobody keeps the money.",
    check: (c) => fresh(c.state.lots, c.base.lots).some((l) => same(l.donor, c.addr("priya")) && l.category === "Water" && l.amount === 25000),
  },
  {
    id: "invoice", part: "A · Honest flow", role: "bluewell", route: "/vendor", target: "vendor-main",
    title: "BlueWell signs invoice BW-2001 with the receipt photo",
    do: [
      "Bill to **Asha Foundation**. Invoice number:", { text: "BW-2001", copy: "BW-2001" },
      "Line 1 — qty **2**, item:", { text: "Hand pump (India Mark II)", copy: "Hand pump (India Mark II)" }, "₹ each **7500**.",
      "**Add line** → qty **5**, item:", { text: "GI pipe 3m", copy: "GI pipe 3m" }, "₹ each **1000** (total ₹20,000).",
      "Attach the receipt (download it below), then **Sign and send to NGO**.",
    ],
    upload: ["original"],
    expect: "Invoice BW-2001 appears as sent, ₹20,000, signed by BlueWell’s key.",
    why: "Verifiable expenditure: the vendor signs (EIP-712) the exact fields plus the receipt’s keccak-256 fingerprint. The photo stays off-chain; change one pixel and the signature breaks.",
    check: (c) => c.invoices.some((i) => i.invoiceNo === "BW-2001" && i.ngoId === 0 && i.id > c.base.invoice),
  },
  {
    id: "cards", part: "A · Honest flow", role: "field", route: "/field", target: "field-cards", captureKeys: "asha",
    title: "Field partner issues 3 QR cards — no names",
    do: ["NGO **Asha Foundation**. Batch label:", { text: "Wadgaon hand-pump households", copy: "Wadgaon hand-pump households" }, "Number of cards **3** → **Issue cards**.", "The drill saves the 3 card keys for you (step 9). Then **Close**."],
    expect: "3 QR cards. On-chain: only the Merkle root of the list, attested by the field partner.",
    why: "Privacy: card keys are made in the browser and never uploaded. Each card later proves “I’m on the list” without revealing who it is.",
    check: (c) => fresh(c.state.batches, c.base.batches).some((b) => b.ngoId === 0 && b.cards === 3),
  },
  {
    id: "request", part: "A · Honest flow", role: "asha", route: "/ngo", target: "ngo-invoices",
    title: "Asha requests the payout against BW-2001",
    do: ["Click invoice **BW-2001**.", "Pick the list **Wadgaon hand-pump households**.", "Check every pre-check is green → **Request payout**."],
    expect: "A payout row with a countdown (the public challenge window).",
    why: "The contract checks category = earmark, budget, vendor signature, unused nullifier, attested cards and dates. Money goes escrow → vendor, never through the NGO.",
    check: (c) => !!payoutOf(c, "asha", (p) => p.ngoId === 0 && p.amount === 20000),
  },
  {
    id: "release", part: "A · Honest flow", role: "asha", route: "/ngo", target: "ngo-payouts",
    title: "Wait ~45 s, then release 70%",
    do: ["Wait for the countdown on the payout row (explain the window meanwhile).", "Click **Release 70%**."],
    expect: "₹14,000 goes to BlueWell; ₹6,000 stays locked until delivery is proven.",
    why: "Anyone could challenge during the window. The last 30% is the vendor’s incentive to actually deliver.",
    check: (c) => ["Released", "Completed"].includes(payoutOf(c, "asha", () => false)?.status),
  },
  {
    id: "deliver", part: "A · Honest flow", role: "field", route: "/field", target: "field-confirm", showKeys: "asha",
    title: "Beneficiaries confirm delivery → final 30%",
    do: ["Click the payout (**Payout #…**).", "Paste card 1 (copy it below) into **Or paste the card key** → “Card is on this payout’s approved list” → **Confirm handover on-chain**.", "Wait until the button reads **Confirm handover on-chain** again, then cards 2 and 3."],
    expect: "After card 3: Completed · Impact verified. The final 30% is paid.",
    why: "Each card signs “delivered for payout #X” with a Merkle proof — delivery is proven, identity stays hidden, no card can confirm twice.",
    check: (c) => payoutOf(c, "asha", () => false)?.status === "Completed",
  },
  {
    id: "passport", part: "A · Honest flow", role: "priya", route: "/passport", target: "passport-list",
    title: "Priya sees the whole journey and the evaluation chain",
    do: ["Open her **Water** donation.", "Scroll to **Probabilistic evaluation chain**."],
    expect: "Journey: donation → escrow → invoice → payout → delivery, with a confidence % for each of the 4 stages.",
    why: "The PS’s chain — Inbound → Escrow → Impact → Invoice — each stage a probability, multiplied into one score (≈96%).",
  },
  {
    id: "fiat", part: "A · Honest flow", role: "anyone", route: "/passport/7", target: "passport-journey",
    title: "Off-chain fiat: ETH → swap → bridge → rupees",
    do: ["Read Rahul’s donation #7 journey, one line per hop.", "Optional: sign in as **paylink** to show the fiat agent’s screen."],
    expect: "0.25 ETH → swapped → bridged → PayLink invoice → 70% → ₹20,000 paid in rupees (bank reference hash) → delivered.",
    why: "The PS’s “spent off-chain via local fiat vendors”: the agent signs a FiatSettlement; the same bank transfer can’t back two payouts.",
  },
  {
    id: "shadow-card", part: "B · The attack", role: "field", route: "/field", target: "field-cards",
    title: "Attack setup · 1 card for Shadow Trust",
    do: ["NGO **Shadow Trust**. Label:", { text: "Shadow 'beneficiaries'", copy: "Shadow 'beneficiaries'" }, "Cards **1** → **Issue cards** → **Close**."],
    expect: "One card list attested for Shadow Trust.",
    why: "The cheating NGO needs a delivery list to request a payout — every on-chain check will pass.",
    check: (c) => fresh(c.state.batches, c.base.batches).some((b) => b.ngoId === 1),
  },
  {
    id: "rescan", part: "B · The attack", role: "bluewell", route: "/vendor", target: "vendor-main",
    title: "The same receipt, re-scanned as BW-2077",
    do: ["Bill to **Shadow Trust**. Invoice number:", { text: "BW-2077", copy: "BW-2077" }, "Same two lines as before (2 × 7500, 5 × 1000).", "Attach the **re-scanned copy** (download below) → **Sign and send to NGO**."],
    upload: ["rescan"],
    expect: "Invoice BW-2077 sent to Shadow Trust.",
    why: "Double-counting one piece of evidence: a new number makes a new file hash, so a hash-only system would miss it.",
    check: (c) => c.invoices.some((i) => i.invoiceNo === "BW-2077" && i.id > c.base.invoice),
  },
  {
    id: "fraud", part: "B · The attack", role: "shadow", route: "/ngo", target: "ngo-invoices",
    title: "Shadow Trust requests the payout — and gets challenged",
    do: ["Click **BW-2077** → pick **Shadow 'beneficiaries'** → **Request payout**.", "Watch the payout row for a few seconds."],
    expect: "It turns **Disputed / Challenged** — the open watcher bot matched the image to BW-2001 and challenged it with its own bond.",
    why: "Perceptual image fingerprint (dHash) catches what a hash can’t. The challenge is public — no central auditor.",
    check: (c) => payoutOf(c, "fraud", (p) => p.ngoId === 1 && p.amount === 20000)?.status === "Challenged",
  },
  {
    id: "court", part: "B · The attack", role: "navkiran", route: "/watchtower", target: "watch-court",
    title: "The donors whose money is at stake decide",
    do: ["On the dispute: **Uphold · …**.", "Wait for the vote window (~45 s) → **Resolve on-chain**."],
    expect: "Payout cancelled. Shadow’s bond and BlueWell’s stake go to the watcher who caught it.",
    why: "The challenge court: funding donors vote, weighted by their rupees. Lying costs the liar; catching fraud pays.",
    check: (c) => !!payoutOf(c, "fraud", () => false)?.challenge?.resolved,
  },
  {
    id: "freeze", part: "B · The attack", role: "watcher", route: "/watchtower", target: "watch-redteam",
    title: "Duplicate + forgery → automatic freeze",
    do: ["Red team → **Run** “Resubmit duplicate”.", "Not frozen yet? Click **Understood**, then **Run** “Forge signature”.", "The red Freeze Frame appears → **Understood**."],
    expect: "Shadow Trust is frozen by the contract — no more payouts possible.",
    why: "Two fraud flags freeze the NGO in the same transaction. No human pressed a button; no admin key exists.",
    check: (c) => !!c.state.ngos[1]?.frozen,
  },
  {
    id: "redirect", part: "B · The attack", role: "watcher", route: "/watchtower", target: "watch-stuck",
    title: "Frozen money moves to the donor’s fallback",
    do: ["**Stuck money** → **Redirect to Asha Foundation**."],
    expect: "Navkiran’s unspent gift moves to its fallback NGO, Asha.",
    why: "Dead-man switch: a frozen NGO can’t trap donors’ money. Anyone can trigger the redirect.",
    check: (c) => c.state.lots.some((l) => l.redirectedFrom != null),
  },
  {
    id: "reconcile", part: "B · The attack", role: "watcher", route: "/watchtower", target: "watch-reconciler",
    title: "Published report vs the chain",
    do: ["**Load example: double-counted report** → **Reconcile against the chain**."],
    expect: "Over-claimed, over-attributed, double-counted (200%).",
    why: "Discrepancy detection: the NGO told two donors the same invoice was theirs. The chain says otherwise.",
  },
  {
    id: "benchmark", part: "B · The attack", role: "watcher", route: "/watchtower", target: "watch-redteam",
    title: "100 receipts, 30% forged",
    do: ["**Run 100-receipt benchmark** (≈25 s).", "Point at the escrow ledger: gap ₹0."],
    expect: "30/30 frauds caught, 0/70 false alarms, every rupee accounted for.",
    why: "One demo case can be luck; 100 mixed receipts prove the detectors work together.",
  },
  {
    id: "verify", part: "Verify", role: "anyone", route: "/verify", target: "verify-drop",
    title: "Don’t trust us — verify it yourself",
    do: ["Drop the **genuine receipt** → “This exact file backs payout #… — Completed”.", "Drop the **re-scanned copy** → it backs Shadow’s **Cancelled** payout.", "Audit a payout by number; see Shadow Trust **Frozen by contract**."],
    upload: ["original", "rescan"],
    expect: "Every verdict computed in the browser, straight from the blockchain node.",
    why: "“Independently verifiable” — GlassVault’s database and API are not used for any answer.",
  },
  {
    id: "acceptance", part: "Verify", role: "terminal", route: null, target: null,
    title: "Every requirement, checked automatically",
    do: ["In a terminal in the glassvault folder:", { text: "npm run acceptance", copy: "npm run acceptance" }],
    expect: "12/12 requirements met — on real contract execution.",
    why: "Each PS 4.2 line maps to an automated check judges can re-run.",
  },
  {
    id: "done", part: "Done", role: "anyone", route: "/", target: null,
    title: "Drill complete",
    do: ["Closing line: “Money moves only when proof moves. And if an NGO lies, it doesn’t just get caught — it pays whoever caught it.”", "Reset before the next audience: `npm run stop`, then `npm run start:prod`."],
    expect: "Every role, every requirement, live.",
    why: "",
  },
];

const KEY = "gv.drill";
export function loadDrill() {
  try {
    return JSON.parse(sessionStorage.getItem(KEY)) ?? null;
  } catch {
    return null;
  }
}
export function saveDrill(d) {
  try {
    if (d) sessionStorage.setItem(KEY, JSON.stringify(d));
    else sessionStorage.removeItem(KEY);
  } catch {
    // no storage: the drill still works, it just won't survive a reload
  }
}
/// True while a drill is open — the role tours stay quiet so they don't cover the drill.
export const drillActive = () => !!loadDrill()?.open;
