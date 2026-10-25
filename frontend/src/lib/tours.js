// Role-based guided tours. Each step: { route, target (data-tour id, or null = centred card), title, body }.
// Bodies tell THAT role exactly what to click next and why it builds trust. Tours are built from the
// account's current on-chain state (registered yet? donated yet?) when the tour starts, so the first real
// step is always the one this account needs. A missing target falls back to a centred card.

const REPLAY = " Replay this tour anytime from the Tour button (bottom-right).";
const same = (a, b) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

function guest() {
  return [
    { route: "/", target: "landing-hero", title: "Welcome to GlassVault", body: "Donated money sits in a smart contract and moves only when proof moves. This tour takes a minute — use ← → or the buttons; Esc skips." },
    { route: "/", target: "landing-how", title: "How one rupee moves", body: "Donate with a purpose → locked in escrow → 70% on a vendor-signed invoice → 30% when beneficiaries' cards confirm delivery. Nothing skips a step." },
    { route: "/", target: "landing-roles", title: "Five roles, no admin", body: "Donors, NGOs, vendors, field partners and watchers each hold one part of the proof — and nobody, not even us, can move money by hand." },
    { route: "/", target: "explore-pipeline", title: "Every rupee, live", body: "Read straight from the chain: how much is held in escrow, released to vendors and proven by beneficiaries." },
    { route: "/", target: "explore-sankey", title: "Where the money went", body: "Follow each rupee from donor to NGO to purpose to vendor. Hatched bands are still waiting for proof." },
    { route: "/", target: "explore-ngos", title: "Reputation nobody can fake", body: "Trust scores and proof confidence come only from on-chain history — an NGO can't write its own report card." },
    { route: "/passport", target: "passport-list", title: "Public donation passports", body: "Open any donation: its journey across chains, every payout and how sure you can be about each step." },
    { route: "/watchtower", target: "watch-overview", title: "Anyone can audit", body: "Every fraud attempt is recorded here. Spot something wrong and you can challenge it — and earn the cheater's bond." },
    { route: "/signup", target: null, title: "Join in", body: "Create an account for your role, with a password or with MetaMask. Your wallet's key never leaves your browser." },
  ];
}

function donor(user, state) {
  const hasGiven = state?.lots?.some((l) => same(l.donor, user.address));
  return [
    { route: "/passport", target: null, title: `Welcome, ${user.displayName}`, body: "As a donor you give for a purpose and can check every rupee yourself. Here is exactly what to do." },
    { route: "/passport", target: "next-actions", title: "Your to-do list", body: "This strip shows what needs you right now: disputes to vote on, refunds to claim, money to move to your fallback NGO." },
    { route: "/donate", target: "donate-ngo", title: hasGiven ? "Give again — pick an NGO" : "Make your first donation — pick an NGO", body: "Click an NGO card. Compare trust score and proof confidence — both are computed from the chain, not written by the NGO." },
    { route: "/donate", target: "donate-amount", title: "Lock the purpose and amount", body: "Pick Water, Medical or Education and type an amount. The purpose is locked to your money: only vendors of that category can be paid from it." },
    { route: "/donate", target: "donate-fallback", title: "Decide what happens if the NGO fails", body: "Choose “Refund me” or a fallback NGO. If the NGO is frozen or misses the deadline, nobody can keep your money." },
    { route: "/donate", target: "donate-summary", title: "Check where it goes, then donate", body: "The diagram shows the split: 70% on a signed invoice, 30% after delivery. Press Donate and approve — your gift becomes a tracked lot." },
    { route: "/passport", target: "passport-list", title: "Follow every donation", body: "Open a donation to see its four proofs, the journey of every rupee and the chain confidence — the probability each step really happened." },
    { route: "/watchtower", target: "watch-court", title: "Vote when your money is disputed", body: "If someone challenges a payout funded by you, vote Uphold or Reject here. Your vote is weighted by your share of that payout." },
    { route: "/watchtower", target: "watch-stuck", title: "The dead-man switch", body: "Unproven or expired money is returned or moved to your fallback — anyone can press it, so your gift never gets stuck." + REPLAY },
  ];
}

function ngo(user, state) {
  const registered = state?.ngos?.some((n) => same(n.admin, user.address));
  return [
    { route: "/ngo", target: null, title: `Welcome, ${user.displayName}`, body: "As an NGO you receive purpose-locked donations and pay vendors — but only against proof. Here is the order to work in." },
    registered
      ? { route: "/ngo", target: "next-actions", title: "Your to-do list", body: "Invoices waiting to be paid, payouts to release and deliveries still to prove — always your next step." }
      : { route: "/ngo", target: "ngo-register", title: "Register and post your ₹10,000 bond", body: "Click “Post bond and register”. The bond goes to whoever proves fraud against you — that is why donors can trust you." },
    { route: "/ngo", target: "ngo-health", title: "Your trust score at a glance", body: "Completed, proven payouts raise it; fraud flags and lost challenges cut it. Donors see the same number." },
    { route: "/ngo", target: "ngo-vaults", title: "Money held for you, by purpose", body: "Donations wait in escrow per purpose. You never hold the money — you can only direct it to a vendor with proof." },
    { route: "/ngo", target: "ngo-invoices", title: "Pay a vendor's signed invoice", body: "Click an invoice in the inbox, pick the card list a field partner issued for you, check every pre-check is green, then “Request payout”." },
    { route: "/ngo", target: "ngo-payouts", title: "Release 70%, then prove delivery", body: "After the public challenge window, press “Release 70%”. The last 30% is paid automatically when beneficiaries' cards confirm delivery." },
    { route: "/watchtower", target: "watch-court", title: "If a payout is challenged", body: "Anyone can dispute a payout during its window; the donors who funded it decide. Honest proof wins, and the challenger's bond comes to you." + REPLAY },
  ];
}

function vendor(user, state) {
  const v = state?.vendors?.find((x) => same(x.address, user.address));
  const steps = [
    { route: "/vendor", target: null, title: `Welcome, ${user.displayName}`, body: "As a vendor you get paid straight from escrow — once you sign the invoice for what you delivered." },
    v?.slashed
      ? { route: "/vendor", target: null, title: "This wallet was slashed", body: "Fraud was proven against an invoice this vendor signed: its stake went to whoever caught it and the contract bans the wallet for good. That is the deterrent working." }
      : v?.registered
      ? { route: "/vendor", target: "next-actions", title: "Your to-do list", body: "Invoices to issue, payouts on their way and — for fiat agents — rupee payments still to prove." }
      : { route: "/vendor", target: "vendor-main", title: "Register with a ₹5,000 stake", body: "Choose “Supplier” or “Fiat payment agent”, your category and legal name, then register. A fake vendor costs real money — that is the point." },
    { route: "/vendor", target: "vendor-main", title: "Issue and sign an invoice", body: "Pick the NGO, invoice number and items, attach the receipt photo, then “Sign and send to NGO”. Your signature covers every field — change one and it breaks." },
    { route: "/vendor", target: "vendor-history", title: "What happened to each invoice", body: "Signed, used in a payout, paid. A signed invoice can never be claimed twice — by you or any NGO." },
    { route: "/vendor", target: "vendor-earnings", title: "Paid vs still in escrow", body: "Yellow is in your wallet; dashed is still held and released when the NGO's proof arrives." },
  ];
  steps.push(
    v?.offRamp
      ? { route: "/vendor", target: "vendor-settle", title: "Prove each rupee payment", body: "After a release, enter the bank transfer reference (UTR) and sign before the deadline. A UTR works once; miss the deadline and you lose your stake." + REPLAY }
      : { route: "/vendor", target: "vendor-settle", title: "Fiat agents prove rupee payments", body: "Payment agents who pay village shops in cash or UPI sign a settlement for each release — this section is where they do it." + REPLAY },
  );
  return steps;
}

function field(user, state) {
  const registered = state?.fieldPartners?.some((f) => same(f.address, user.address) && f.registered);
  return [
    { route: "/field", target: null, title: `Welcome, ${user.displayName}`, body: "As a field partner you are independent of every NGO: you issue beneficiaries' cards and confirm each handover." },
    registered
      ? { route: "/field", target: "next-actions", title: "Your to-do list", body: "Card lists to issue and deliveries waiting for beneficiaries' cards." }
      : { route: "/field", target: "field-cards", title: "Stake ₹2,000 and register", body: "Click “Stake and register”. Your stake makes your word worth something — an NGO can't vouch for its own beneficiaries." },
    { route: "/field", target: "field-cards", title: "Issue cards for an NGO", body: "Pick the NGO, a label and how many beneficiaries, then “Issue cards”. Keys are created in this browser — print them; only a fingerprint of the list goes on-chain, never a name." },
    { route: "/field", target: "field-progress", title: "Watch delivery progress", body: "Each ring is one payout. The final 30% is paid only when its ring is full." },
    { route: "/field", target: "field-confirm", title: "Confirm a handover with the card", body: "Pick the payout, scan the beneficiary's QR card (or paste its key) and press “Confirm handover on-chain”. The card signs it — its key never leaves the card." + REPLAY },
  ];
}

function watcher(user) {
  return [
    { route: "/watchtower", target: null, title: `Welcome, ${user.displayName}`, body: "You audit in the open. You hold no special power — the same buttons work for anyone — but catching fraud pays." },
    { route: "/watchtower", target: "next-actions", title: "Your to-do list", body: "Payouts you can still review, overdue rupee proofs and stuck money you can unlock." },
    { route: "/watchtower", target: "watch-overview", title: "Fraud at a glance", body: "Every fraud attempt the contracts recorded, by type and over time." },
    { route: "/watchtower", target: "watch-court", title: "Challenge a payout in its window", body: "Spot a bad payout? Post a ₹500 bond with evidence. If its donors uphold it, you take the NGO's bond and the vendor's stake." },
    { route: "/watchtower", target: "watch-graveyard", title: "The receipt graveyard", body: "Every rejected receipt and why — duplicates, forged signatures, impossible dates, reused bank transfers." },
    { route: "/watchtower", target: "watch-offramp", title: "Flag unexplained transfers", body: "Money released to a fiat agent but never proven paid in rupees? After the deadline press “Flag” — the agent's stake is yours." },
    { route: "/watchtower", target: "watch-stuck", title: "Unlock stuck money", body: "Return unproven 30% tranches to donors and move expired donations to their fallback NGO." },
    { route: "/watchtower", target: "watch-reconciler", title: "Check an NGO's published report", body: "Click “Load example”, then “Reconcile against the chain”: every claim is compared with real transactions and double counting is shown line by line." },
    { route: "/watchtower", target: "watch-redteam", title: "Run the red team", body: "Run the problem statement's attacks yourself — and the 100-receipt benchmark — and watch what gets caught." + REPLAY },
  ];
}

const BUILD = { Donor: donor, NGO: ngo, Vendor: vendor, Field: field, Watcher: watcher };

/// The tour for this account, shaped by its state right now (call once when the tour starts).
export const tourFor = (user, state) => (user && BUILD[user.kind] ? BUILD[user.kind](user, state) : guest());
export const tourKey = (user) => `gv-tour:v2:${user?.username ?? "guest"}`;
