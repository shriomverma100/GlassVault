# GlassVault — judges' demo runbook

Every act below was rehearsed end to end through the real UI by `e2e/demo-rehearsal.js`
(14 acts, every role, every PS 4.2 requirement). Screenshots of each act are in `demo/shots/`.

## 0 · Before the judges arrive (5 minutes)

1. Stop anything old and start fresh — an old server makes sign-up fail:
   ```bash
   npm run stop          # stops a previous GlassVault (ports 8545, 8546, 4000, 5173)
   npm run start:prod    # fresh chains + contracts + seeded history + production build
   ```
   Wait for `GlassVault is live → http://localhost:5173`.
2. Build the upload kit once: `node demo/make-kit.mjs` → files in `demo/kit/`.
3. Browser: one window per role you want visible at the same time — use **separate browser
   profiles or incognito windows** (each window keeps its own login). Or sign out / in between acts:
   the **Sign in** page has a "Demo accounts" panel that fills username + password with one click.
4. MetaMask (Act 2): install the extension, create a fresh test wallet (no real money). The app adds
   the two GlassVault test chains itself. If MetaMask shows a *nonce* error after a restart:
   MetaMask → Settings → Advanced → **Clear activity tab data**.
5. Zoom the browser to 90% on a projector. Keep a terminal ready for Act 14.

## Logins (local test chains only — public demo credentials)

| Role | Username | Password | Who |
|---|---|---|---|
| Donor | `priya` | `Priya@Donor26` | Priya Nair — individual donor |
| Donor | `rahul` | `Rahul@Donor26` | Rahul Mehta — his 0.25 ETH went through swap → bridge → fiat |
| Donor | `navkiran` | `Navkiran@CSR26` | Navkiran CSR Fund — gave to Shadow Trust with Asha as fallback |
| NGO | `asha` | `Asha@NGO2026` | Asha Foundation — the honest NGO |
| NGO | `shadow` | `Shadow@NGO2026` | Shadow Trust — the adversarial NGO |
| Vendor | `bluewell` | `BlueWell@Vendor26` | BlueWell Pumps — Water supplier |
| Vendor | `medicare` | `Medilink@Vendor26` | Medilink Supplies — Medical supplier |
| Vendor | `vidya` | `Vidya@Vendor26` | Vidya Books — Education supplier |
| Vendor | `quickfix` | `QuickFix@Vendor26` | QuickFix Traders — shell vendor (red team) |
| Fiat agent | `paylink` | `PayLink@Agent26` | PayLink Fiat Agents — pays village shops in rupees |
| Field partner | `field` | `Sahyog@Field26` | Sahyog Field Partners — issues QR cards |
| Watcher | `watcher` | `Watch@Tower26` | OpenLedger Watch — audits, challenges, red team |
| Donor (MetaMask) | — | — | create live with **Continue with MetaMask** |

## Upload kit (`demo/kit/`)

| File | Used in | Why |
|---|---|---|
| `BW-2001-handpumps.png` | Act 4 — BlueWell's invoice | the genuine receipt photo |
| `BW-2001-rescan-as-BW-2077.png` | Act 10 — the live fraud | the **same photo**, re-scanned and re-numbered |
| `VB-310-textbooks.png` | optional — Vidya Books invoice | a second genuine receipt (Education) |

## The demo — 14 acts (~15 min; the 5-minute cut is marked ★)

| # | Login | Do | Say | PS |
|---|---|---|---|---|
| 1 ★ | (signed out) | Open the landing page. Scroll: hero → how it works → roles → KPIs → money pipeline → Sankey → NGO cards. | "Donated money never touches the NGO's wallet. It sits in a contract and moves only when proof moves." | — |
| 2 | MetaMask | **Sign in → Continue with MetaMask** → approve "add chain" + sign the message → pick **Donor**, name, username → **Create**. Then **Donate** → Asha · Water → **Chain B · via bridge** → **Pay in ETH · swapped** → 0.05 → **Swap, bridge and donate**, confirm in MetaMask. | "One transaction swaps ETH to rupees and locks it in the bridge; the relayer delivers it as a lot that still knows me and the purpose." | Purpose-bound · Multi-hop |
| 3 ★ | `priya` | **Donate** → Asha Foundation → **Water** → ₹25,000 → **Send it to another NGO** → Shadow Trust → **Donate**. | "My gift is earmarked Water. If Asha fails, it moves to my fallback — nobody can keep it." | Purpose-bound |
| 4 ★ | `bluewell` | **Invoices** → bill to Asha → `BW-2001` → lines: 2 × Hand pump ₹7,500, 5 × GI pipe ₹1,000 → attach `BW-2001-handpumps.png` → **Sign and send to NGO**. | "The vendor signs the exact fields plus the photo's fingerprint. Change one digit and the signature breaks." | Verifiable expenditure |
| 5 ★ | `field` | **Deliveries** → Asha Foundation → label "Wadgaon hand-pump households" → 3 cards → **Issue cards**. Copy the 3 card keys (they are the printed QR cards). | "An independent partner makes the cards in the browser. Only a fingerprint of the list goes on-chain — no names." | Privacy |
| 6 ★ | `asha` | **NGO console** → click invoice **BW-2001** → pick "Wadgaon hand-pump households" → see every pre-check green → **Request payout**. | "Category, budget, signature, duplicate check, attested cards, dates — the contract checks all of it." | Purpose-bound · Verifiable expenditure |
| 7 | `asha` | Wait for the 45-second challenge window → **Release 70%**. | "Anyone could have challenged it in that window. Only now does 70% move." | Purpose-bound |
| 8 ★ | `field`, then `priya` | **Deliveries** → payout → paste a card key → **Confirm handover on-chain** (×3). Then open Priya's passport → **Probabilistic evaluation chain**. | "Each card signs 'delivered' — the key never touches the chain. Only now is the last 30% paid. Here is how sure you can be, stage by stage." | Privacy · Evaluation chain |
| 9 | `paylink` / anyone | Show PayLink's screen, then open Rahul's passport (donation #7): **Journey**. | "0.25 ETH → swapped → bridged → a fiat agent paid a village shop in rupees, with a signed record of the bank transfer — one hop per line, every hop a transaction." | Multi-hop · Verifiable expenditure |
| 10 ★ | `field`, `bluewell`, `shadow` | Field: 1 card for **Shadow Trust**. BlueWell: invoice `BW-2077` to Shadow with `BW-2001-rescan-as-BW-2077.png`. Shadow: request the payout. Watch it become **Disputed** within seconds. | "Same photo, new number. Every on-chain check passes — but the open watcher bot matched the image and challenged it with its own bond." | Double counting · Freeze w/o auditor |
| 11 | `navkiran` (the funding donor) | **Watchtower** → Disputes → **Uphold** → after the vote window **Resolve on-chain**. | "No auditor: the donors whose money is at stake decided. The NGO's bond and the vendor's stake now belong to whoever caught them." | Freeze w/o auditor |
| 12 ★ | `watcher` | **Watchtower → Red team** → **Run** "Resubmit duplicate" (and "Forge signature" if needed) → the **Freeze Frame**. Then **Stuck money** → **Redirect to Asha Foundation**. | "Duplicate plus forgery — the contract froze Shadow Trust in the same transaction. No human pressed a button. Navkiran's unspent gift moves to its fallback." | Double counting · Forged receipts · Freeze · Purpose-bound |
| 13 | `watcher` | **Reconciler** → **Load example** → **Reconcile against the chain**. | "The NGO told two donors the same ₹40,000 invoice was theirs. The chain says otherwise: 200%." | Reports vs chain · Double counting |
| 14 ★ | `watcher` + terminal | **Run 100-receipt benchmark** (≈25 s). Point at the escrow ledger: gap ₹0. In the terminal: `npm run acceptance` → 12/12. | "100 receipts, 30% forged: 30 of 30 caught, zero false alarms. And every requirement of the problem statement is checked automatically." | Forged receipts · Unexplained transfers |

## Problem statement coverage (from the rehearsal)

| PS 4.2 requirement | Acts |
|---|---|
| Purpose-bound allocation (earmarked funds, disbursement conditions) | 2, 3, 6, 7, 12 |
| Verifiable expenditure records (payout ↔ invoice/receipt commitments) | 4, 6, 9 |
| Privacy protection (no identities on-chain, proof of delivery) | 5, 8 |
| Discrepancy detection (unexplained transfers, categories, reports vs chain) | 13, 14 (+ timeline rules in `npm run acceptance`) |
| Multi-hop: swapped, bridged, spent off-chain via fiat vendors | 2, 9 |
| Adversary double-counts one piece of evidence | 10, 12, 13 |
| Adversary forges 30% of receipts | 12, 14 |
| Detect duplication + freeze escrow without a central auditor | 10, 11, 12 |
| Probabilistic evaluation chain | 8 |

## Closing line

> "Money moves only when proof moves. Proof can't be forged without the vendor's key, can't be reused
> because of nullifiers, and can't expose beneficiaries because only fingerprints go on-chain. And if
> an NGO lies, it doesn't just get caught — it pays whoever caught it."

## If something goes wrong

- **Sign-up / sign-in fails** → an old server is running: `npm run stop`, then `npm run start:prod`.
- **"Release 70%" not showing** → the 45-second window hasn't ended; the countdown is on the payout row.
- **Fresh start for another run** → `npm run stop && npm run start:prod` (≈1 minute, fully re-seeded).
- **Live demo impossible** → the screenshots of every act are in `demo/shots/`, and
  `npm run acceptance` / `npm test` run without the UI.
- **Re-check everything** → `node e2e/demo-rehearsal.js` replays all 14 acts against a running stack.
