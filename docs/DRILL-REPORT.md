# Drill report: full platform, every role, through the public link

**Date:** 26 Oct 2026 · **Target:** the live platform via its Cloudflare tunnel (not localhost) ·
**Build:** `npm run start:prod`, fresh chains, seeded history

The judges' drill is the exact sequence presented live: [demo/JUDGES-DRILL.md](../demo/JUDGES-DRILL.md),
step by step, with the reason for each step. It was replayed through the real UI by
`e2e/demo-rehearsal.js`, and every other suite was run against the same public URL.

## Results

| Run | What it exercises | Result |
|---|---|---|
| Judges' drill (`e2e/demo-rehearsal.js`) | 14 steps, all 5 roles, both NGOs: earmarked donation with fallback, MetaMask ETH swap → bridge, signed invoice + receipt, QR cards, payout, challenge window, 70% / 30% release, card-signed delivery, fiat off-ramp, re-scanned duplicate, donor court, auto-freeze, dead-man redirect, reconciler, 100-receipt benchmark | **14 / 14 steps · 9 / 9 PS requirements** |
| PS acceptance (`npm run acceptance`) | each PS 4.2 requirement on real contract execution | **12 / 12** |
| Red-team benchmark (in the drill, step 14) | 100 receipts, 30% fraudulent | **30 / 30 caught · 0 / 70 false alarms** |
| Escrow invariant (end of drill) | vault balance = lots + reserved + bonds + stakes | **gap ₹0** |
| MetaMask journey (`e2e/metamask.js`) | add chain, Sign-In with Ethereum, sign-up, donate on A, switch to B, swap + bridge, sign back in | **pass** |
| Smoke, tours, evaluation chain, SIWE, sign-up, multi-hop, flow, attack, performance | every page and role workspace | **pass** |

## PS 4.2 coverage in the drill

| Requirement | Drill steps |
|---|---|
| Purpose-bound allocation | 2, 3, 6, 7, 12 |
| Verifiable expenditure records | 4, 6, 9 |
| Privacy protection + proof of delivery | 5, 8 |
| Discrepancy detection (transfers, categories, reports vs chain) | 13, 14 |
| Multi-hop: swapped, bridged, off-chain fiat | 2, 9 |
| Adversary double-counts one piece of evidence | 10, 12, 13 |
| Adversary forges 30% of receipts | 12, 14 |
| Detect duplication + freeze without a central auditor | 10, 11, 12 |
| Probabilistic evaluation chain | 8 |

## Found and fixed during the drill

| Issue | Fix |
|---|---|
| MetaMask sign-in through the public link was rejected ("Sign-in message is for a different site"): the shared-host allowlist was split on a broken pattern, so the tunnel host never matched | `backend/src/auth.js` splits `.gv/shared-hosts.txt` on whitespace |
| A visitor's MetaMask on another machine was handed `127.0.0.1` chain RPCs, which point at the visitor's own computer | `frontend/src/lib/metamask.js` gives remote visitors the site's own `/rpcA` and `/rpcB` proxies |
| Over the tunnel the indexer saw a delivery before the browser's receipt poll returned, so the next card was pasted while the button still read *Confirming…* | the rehearsal waits for the button, as a presenter does; the guide says so in step 8 |
| The rehearsal clicked through the freeze overlay | it now dismisses it ("Understood") the way a presenter does |

## Reproduce

```bash
npm run stop && npm run start:prod        # fresh platform
npm run share                             # public link (optional)
node demo/make-kit.mjs                    # upload files → demo/kit/
BASE=<link or http://localhost:5173> node e2e/demo-rehearsal.js
npm run acceptance
npm run stop && npm run start:prod        # reset again before a live audience
```
