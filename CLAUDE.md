# GlassVault — Verifiable NGO Fund Flows (CASCADE '26, PS 4.2)

Hackathon build, 8-hour budget. Demo-first: the 4 evaluation roots must always work.

## The 4 evaluation roots (every feature maps to one)
1. **Inbound Donation** — purpose-tagged dINR lots
2. **Escrow Condition** — category, budget, milestone, deadline refund; no admin override
3. **Off-Chain Invoice Proof** — EIP-712 vendor signature + file hash + invoice nullifier
4. **Cryptographic Impact Verification** — beneficiary Merkle proof + delivery nullifier

## Layout
- `contracts/` Hardhat 2 + OpenZeppelin 5, Solidity 0.8.24. Chain A :8545 (31337), chain B :8546 (31338)
- `backend/` Express + WebSocket (ESM). Stores files, relays bridge, runs watcher bots. **Never decides fraud** — contracts do.
- `frontend/` React 19 + Vite + Tailwind v4 + Framer Motion + Lenis

## Contract rules
- Checks-effects-interactions; `ReentrancyGuard` on anything that transfers
- No admin can freeze, unfreeze or move funds — only contract rules
- Emit an event for every state change (the UI is driven by events)
- No PII on-chain: hashes, nullifiers and Merkle roots only
- Every contract feature gets a test, including the attack case

## Design rules
- Colours: white / black / yellow tokens in `frontend/src/index.css` only. No other hues.
- Yellow = proven/active. Black + hatch = fraud/frozen. Status uses fill + pattern + icon, never colour alone.
- Separation by 1px `border-hairline` only. No drop shadows.
- Custom SVG icons in `components/icons` (1.25 stroke, 20px grid). No emoji in UI.
- Motion presets from `lib/motion.js` (`liquid`, `snappy`, `drift`) — don't invent new springs.

## Commands
- `npm start` — whole platform from scratch (chains, deploy, backend, seed, frontend)
- `npm run test` — contract tests · `npm run benchmark` · `npm run e2e` / `npm run e2e:attack`
- `npm run chain:a` / `npm run chain:b` — local chains
- `npm run backend` / `npm run frontend`

## Agents (from everything-claude-code toolkit)
`.claude/agents/`: security-reviewer (after contract phases), build-error-resolver, code-reviewer (phase gates).
Toolkit hooks are intentionally NOT used (tmux rule breaks Vite on Windows).
