# GlassVault — every rupee, provable

**CASCADE '26 · Theme 4 · PS 4.2 — The Black Hole Ledger: Verifiable NGO Fund Flows**

Donated money sits in a smart-contract escrow and moves only when proof moves. An NGO can't spend
outside the donor's purpose, can't reuse or forge an invoice, and can't finish a payout without
beneficiaries proving delivery. Fraud attempts are recorded on-chain and two of them freeze the NGO
automatically — no auditor, no admin key.

## Run it

```bash
npm run install:all     # once
npm start               # 2 chains → deploy → backend → seed real history → http://localhost:5173
```

Use the role switcher (top right) to act as a donor, NGO, vendor, field worker or watcher. Every
role is a funded wallet on the local chain and every action is a real signed transaction.

| Command | What it does |
|---|---|
| `npm test` | 38 contract tests (happy path + every attack) |
| `npm run benchmark` | 100 receipts, 30% fraudulent, against fresh contracts on an isolated chain |
| `npm run attack` | Live red-team attack on the running chain (also available as buttons in Watchtower) |
| `npm run e2e` / `npm run e2e:attack` | Headless browser tests that drive the real UI |
| `npm run check` | Contract tests + benchmark + lint + production build — must pass before every merge |
| `npm run perf` | UI responsiveness probe (page-switch latency, scroll settle, dropped frames) against the running app, compared to `e2e/perf-baseline.json` |

## The 4 evaluation roots

| Root | How it is enforced | Where you see it |
|---|---|---|
| **① Inbound donation** | `donate()` creates a lot tagged with donor, NGO, category, deadline and source chain. Bridged donations from chain B keep the original donor and source chain. | Donate, Passport |
| **② Escrow condition** | Category must match, shares must fit each lot's budget and add up to the invoice, lot must not be expired. A challenge window opens; after it, anyone can release 70%. No admin role exists. Missed deadline or a freeze → donors reclaim. | NGO console, Passport |
| **③ Off-chain invoice proof** | Vendor signs the invoice fields (EIP-712). File hash on-chain, file stored by IPFS CID. A field-level **nullifier** `keccak(vendor, invoiceNo, date, amount)` is global across all NGOs, so a re-scanned invoice still collides. | Vendor portal, NGO pre-checks |
| **④ Impact verification** | Beneficiaries hold QR cards with a secret. Only a Merkle root of commitments goes on-chain; delivery = Merkle proof + one-time delivery nullifier. The final 30% is paid only after enough deliveries; donors receive a soulbound Proof-of-Impact token. | Field app, Passport |

## How fraud is caught (without a central auditor)

| Attack (from the PS) | Caught by | Result |
|---|---|---|
| Same receipt in several donor reports / NGOs | Global invoice nullifier (on-chain) | Fraud flag |
| Forged receipt / amount edited after signing | EIP-712 vendor signature (on-chain) | Fraud flag |
| Invoice from a fake vendor | Vendor registry + stake (on-chain) | Fraud flag |
| Spending outside the declared category / over budget | Escrow checks (on-chain) | Fraud flag |
| Real vendor colluding, re-using an old receipt photo | Watcher bot: 256-bit perceptual hash → files a bonded `challenge()` | Donors vote; upheld → payout cancelled, NGO bond + vendor stake slashed to the challenger |
| Published report ≠ ledger, same invoice told to many donors | Report Reconciler | Over-claims, over-attribution, double counting flagged line by line |

**2 fraud flags → the contract freezes the NGO.** Pending payouts unwind and donors reclaim every unpaid rupee.

The watcher bot holds no special power: it calls the same public `challenge()` any citizen can, with
its own bond. Challenges are decided by the donors whose money funds that payout, weighted by amount,
with a quorum of half the payout.

### Benchmark (real contract execution)

| | |
|---|---|
| Fraudulent receipts caught | **30 / 30** (100% recall) |
| False alarms on genuine receipts | **0 / 70** (100% precision) |
| Two frauds in a row | NGO frozen |

## Architecture

```
frontend (React + Vite + Tailwind + Framer Motion + D3)
   │  signs txs directly on the chains (ethers v6)        │ REST + WebSocket
   ▼                                                      ▼
chain A :8545 ── GlassVault · DINR · ProofOfImpact ◄── backend (Express)
   ▲               BridgeGateway                          ├ indexer   — chain is the only source of truth
   │ relayer                                              ├ watcher   — perceptual hash + Benford, files challenges
chain B :8546 ── DINR · BridgeGateway                     ├ relayer   — chain B → chain A donations
                                                          ├ files     — IPFS-compatible CIDs (raw, sha-256)
                                                          └ reconciler
```

- `contracts/` — Solidity 0.8.28, Hardhat, OpenZeppelin 5
- `backend/` — Node.js ESM; never decides fraud, only indexes, stores, relays and files challenges
- `frontend/` — the web platform
- `e2e/` — browser tests (Playwright driving Edge)

## Honest limitations

- **Local chains.** Two Hardhat nodes stand in for two real networks; demo roles use the public Hardhat dev mnemonic.
- **Bridge relayer is one trusted key.** Replays are blocked on-chain; production would use a light client or Chainlink CCIP. A failed delivery has no refund path on the source chain yet.
- **NGO-issued QR secrets.** The NGO generates beneficiary cards, so in theory it could confirm its own deliveries. In production cards come from an independent field partner.
- **Sybil voting.** An NGO could donate to itself from another wallet to outvote donors on a challenge. Quorum makes it harder; a per-lot veto is the proper fix.
- **Receipt photos in the benchmark are generated** (lighting, folds, stamps). The cryptographic checks don't depend on that, but the perceptual-hash threshold would need tuning on real phone photos.
- **Files are stored locally** under real IPFS CIDs; pinning them to an IPFS node is a config change, not a code change.
- The 30% impact tranche has no timeout if deliveries never complete; bonds and stakes can't be withdrawn.
