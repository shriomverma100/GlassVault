// Role-based guided tours. Each step: { route, target (data-tour id, or null = centred card), title, body }.
// Bodies tell THAT role exactly what to do next, in plain language. A missing target (e.g. a section that
// only exists after registration) falls back to a centred card, so steps never dead-end.

const welcome = {
  route: null,
  target: null,
  title: "Welcome to GlassVault",
  body: "Donated money sits in a smart contract and moves only when proof moves. This short tour shows you what to do here. Use ← → or the buttons; Esc skips.",
};

export const TOURS = {
  Guest: [
    { ...welcome, route: "/" },
    { route: "/", target: "explore-kpis", title: "Live from the chain", body: "Every number here is read from the blockchain — rupees tracked, held in escrow, paid out, frauds caught and the average proof confidence." },
    { route: "/", target: "explore-pipeline", title: "The money pipeline", body: "Donated → held in escrow → released to vendors against signed invoices → impact verified by beneficiaries. Nothing skips a stage." },
    { route: "/", target: "explore-fraud", title: "Fraud caught, by type", body: "Duplicate invoices, forged signatures, reused bank transfers, impossible dates — caught by contract rules and open watchers, no central auditor." },
    { route: "/", target: "explore-sankey", title: "Where the money went", body: "Follow every rupee from donor to NGO to purpose to vendor. Hatched bands are still waiting for proof." },
    { route: "/", target: "explore-ngos", title: "NGO reputation", body: "Trust scores and proof confidence come only from on-chain history — an NGO can't write its own report card." },
    { route: "/passport", target: "passport-list", title: "Donation passports", body: "Every donation has a public passport: its journey across chains, every payout, and how sure you can be about each step." },
    { route: "/watchtower", target: "watch-overview", title: "The watchtower", body: "Anyone can audit payouts here, challenge suspicious ones and earn the cheater's bond." },
    { route: "/signup", target: null, title: "Join in", body: "Create an account as a donor, NGO, vendor, field partner or watcher — or continue with MetaMask. Your wallet's key never leaves your browser." },
  ],

  Donor: [
    { ...welcome, route: "/passport" },
    { route: "/passport", target: "next-actions", title: "Your to-do list", body: "This strip always shows what needs you: disputes to vote on, refunds you can claim, money you can move to your fallback NGO." },
    { route: "/donate", target: "donate-ngo", title: "1 · Pick an NGO", body: "Choose who receives your gift. Compare trust scores and proof confidence — both are computed from the chain." },
    { route: "/donate", target: "donate-amount", title: "2 · Purpose and amount", body: "Pick Water, Medical or Education. The purpose is locked to your money: it can only be spent with vendors of that category." },
    { route: "/donate", target: "donate-fallback", title: "3 · If the NGO fails", body: "Choose a refund or a fallback NGO. If the NGO is frozen or misses the deadline, unspent money returns to you or moves on — automatically, nobody can keep it." },
    { route: "/donate", target: "donate-summary", title: "4 · Check and donate", body: "This shows exactly where your rupees go. Press Donate and approve with your wallet — your donation becomes a tagged, trackable lot." },
    { route: "/passport", target: "passport-list", title: "Your donations", body: "Open any donation to see its proof steps, a breakdown of where the money is, its probabilistic evaluation chain and every hop of its journey." },
    { route: "/watchtower", target: "watch-court", title: "Vote on disputes", body: "If someone challenges a payout funded by your money, you vote here — your vote is weighted by how much of that payout is yours." },
    { route: "/watchtower", target: "watch-stuck", title: "Never stuck", body: "Unproven or expired money can be returned or redirected by anyone — including you. That's the dead-man switch protecting your gift." },
  ],

  NGO: [
    { ...welcome, route: "/ngo" },
    { route: "/ngo", target: "next-actions", title: "Your to-do list", body: "Invoices to pay, payouts to release, deliveries still to prove, disputes — always the next step for your NGO." },
    { route: "/ngo", target: "ngo-register", title: "First: register and post your bond", body: "New NGOs lock a ₹10,000 bond. It's paid to whoever proves fraud against you — that's why donors can trust you. (Already registered? Skip ahead.)" },
    { route: "/ngo", target: "ngo-health", title: "Your health at a glance", body: "Your trust score and where your payout money stands. Completed, proven payouts raise the score; fraud flags and lost challenges cut it." },
    { route: "/ngo", target: "ngo-vaults", title: "Money held for you", body: "Donations wait in escrow per purpose. You never hold the money — you can only direct it to vendors with proof." },
    { route: "/ngo", target: "ngo-invoices", title: "Pay a vendor", body: "Open a vendor-signed invoice. The donor lots are picked for you; choose a card list a field partner attested for you, check the green pre-checks, then request the payout." },
    { route: "/ngo", target: "ngo-payouts", title: "Release and prove", body: "Each payout waits out a public challenge window, then 70% is released. The last 30% follows when beneficiaries confirm delivery with their cards." },
  ],

  Vendor: [
    { ...welcome, route: "/vendor" },
    { route: "/vendor", target: "next-actions", title: "Your to-do list", body: "Invoices to issue, payouts on their way and — for fiat agents — rupee payments you still need to prove." },
    { route: "/vendor", target: "vendor-main", title: "Register, then sign invoices", body: "First stake ₹5,000 as a supplier or as a fiat payment agent (you pay local shops in rupees). Then fill in an invoice, attach the receipt and sign it with your wallet." },
    { route: "/vendor", target: "vendor-earnings", title: "Track your money", body: "Yellow is paid to you; dashed is still in escrow and is released when the NGO's proof arrives." },
    { route: "/vendor", target: "vendor-settle", title: "Fiat agents: prove the rupee payment", body: "After a release, enter the bank transfer reference and sign. A reference can be used only once; miss the deadline and anyone can flag it and take your stake." },
    { route: "/vendor", target: "vendor-history", title: "Your invoices", body: "Every invoice you signed and what happened to it. A signed invoice can't be reused — not by you, not by any NGO." },
  ],

  Field: [
    { ...welcome, route: "/field" },
    { route: "/field", target: "next-actions", title: "Your to-do list", body: "Registration, card lists to issue and deliveries waiting for beneficiaries' cards." },
    { route: "/field", target: "field-cards", title: "Issue cards for an NGO", body: "Register once (₹2,000 stake), then pick an NGO and the number of beneficiaries. The cards' keys are created in this browser — print them; no names ever go on-chain." },
    { route: "/field", target: "field-progress", title: "Delivery progress", body: "How many beneficiaries confirmed each payout. The final 30% is paid only when a payout's ring is full." },
    { route: "/field", target: "field-confirm", title: "Confirm a handover", body: "At delivery, pick the payout and scan the beneficiary's card. The card signs the handover — its key never leaves the card, and it can't confirm twice." },
  ],

  Watcher: [
    { ...welcome, route: "/watchtower" },
    { route: "/watchtower", target: "next-actions", title: "Your to-do list", body: "Payouts you can still review before their window closes, overdue rupee proofs and stuck money you can unlock." },
    { route: "/watchtower", target: "watch-overview", title: "Fraud at a glance", body: "Every fraud attempt recorded on-chain, by type and over time." },
    { route: "/watchtower", target: "watch-court", title: "Challenge a payout", body: "Spot something wrong while the window is open? Post a ₹500 bond with evidence. If the donors uphold it, you earn the NGO's bond and the vendor's stake." },
    { route: "/watchtower", target: "watch-offramp", title: "Unexplained transfers", body: "Released to a fiat agent but never proven paid in rupees? After the deadline, flag it — the agent's stake is yours." },
    { route: "/watchtower", target: "watch-stuck", title: "Unlock stuck money", body: "Return unproven 30% tranches to donors and move expired donations to their fallback NGO — anyone can press these." },
    { route: "/watchtower", target: "watch-reconciler", title: "Check a published report", body: "Paste an NGO's annual report: every claim is compared with the chain, and double-counting is shown line by line." },
    { route: "/watchtower", target: "watch-redteam", title: "Red team", body: "Run the attacks from the problem statement yourself, and the 100-receipt benchmark — see what gets caught." },
  ],
};

export const tourFor = (user) => TOURS[user?.kind] ?? TOURS.Guest;
export const tourKey = (user) => `gv-tour:v1:${user?.username ?? "guest"}`;
