# Contributing

## Setup

```bash
npm run install:all      # contracts, backend, frontend (Node.js ≥ 22.5)
npm start                # dev server with hot reload — or npm run start:prod
```

## The quality gate

Every change must pass:

```bash
npm run check            # contract tests + PS acceptance suite (with benchmark) + lint + production build
npm run e2e:full         # every browser suite on a fresh isolated production stack
```

`npm run check` also runs in CI on every push and pull request.

## Conventions

- **Contracts.** Checks-effects-interactions and `nonReentrant` on anything that transfers; an event
  for every state change; no admin paths; no personal data on-chain; every feature ships with a
  test, including the attack case.
- **Backend.** The chain is the only source of truth: the backend indexes, stores and relays but never
  decides fraud or holds user keys. Validate every input; JSON-only POSTs.
- **Frontend.** Colours only from the white / black / yellow tokens in `frontend/src/index.css`;
  status is shown with fill, pattern and icon, never colour alone; text meets WCAG AA contrast;
  motion presets from `lib/motion.js`; plain language on screen, technical terms behind "See the math".
- **Commits.** One logical change per commit, with a message explaining why.

## Changing demo data

Seeded logins live in `backend/scripts/demo-accounts.js` (mirrored in
`frontend/src/lib/demo-accounts.js`). After changing them or any UI label used by the demo, update
`demo/DEMO-RUNBOOK.md` and re-run `npm run demo:rehearse` against a running stack.
