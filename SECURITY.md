# Security

GlassVault is a hackathon build running on local chains. Its contracts have **not** been externally
audited. This file states what the system protects, how it was reviewed, and where its trust ends.

## Security model

- **No admin key.** No address can move, freeze or unfreeze funds outside the contract rules.
- **Keys stay with users.** Wallets are MetaMask or a keystore encrypted in the browser with the
  user's password; the server stores the ciphertext and a separate scrypt password hash, never a key.
- **No personal data on-chain.** Invoices, bank references and payees appear only as hashes;
  beneficiaries only as a Merkle root of card addresses and card signatures.
- **Defence in depth against fraud.** Contract rules reject or flag forgeries, duplicates and
  impossible timelines; an open watcher challenges what rules can't see; donors decide disputes;
  bonds and stakes make cheating cost money.

## Independent review

The contracts (`GlassVault`, `BridgeGateway`, `MockDEX`, `ProofOfImpact`, `DINR`) and the backend
auth / file layer were reviewed. Every finding was fixed and pinned with a regression test.

| Severity | Finding | Fix |
|---|---|---|
| High | An off-ramp agent could keep the 70% and its stake and pin the blame on the NGO (duplicate bank reference flagged the NGO; freeze and impact-timeout paths skipped the slash) | Reused bank reference slashes the agent, not the NGO; every path that closes an unsettled off-ramp payout slashes the agent |
| High | Stored XSS through uploaded files served on the app origin | Uploads need a session; type sniffed from file bytes (PNG / JPEG / WebP / PDF); served with `nosniff` and a sandbox CSP |
| Medium | Zero-amount share padding could make `release` exceed the gas limit and lock funds | Shares must be non-zero, at most 16 per payout |
| Medium | Sign-In with Ethereum trusted a client-controlled host header | Domain and URI checked against a configured allowlist |
| Medium | Invoice status route had no authorisation (and allowed prototype pollution) | Session + vendor/NGO-admin check, own-key lookups, allowlisted statuses |
| Medium | Bridged donations could be locked forever if the destination refused them | Source-side validation; relayer refunds rejected donations on the source chain |
| Low | Per-username login lockout; unbounded rate-limit map; demo endpoints open | Per-IP and per-IP+username limits with sweeping; demo endpoints local-only and signed-in |

Also checked and found sound: reentrancy guards and checks-effects-interactions on every transfer;
the escrow invariant across release, completion, unwind, resolve, slash, redirect and reclaim;
EIP-712 domain separation (chain id + contract) and malleability-safe recovery; parameterised SQL;
256-bit hashed session tokens; path-traversal-safe file routes.

## Known limitations

- **Single trusted bridge relayer.** Replays are blocked on-chain and rejected donations are
  refunded, but the relayer is one key. Production: Chainlink CCIP or a light client.
- **Fiat-agent trust.** A rupee payment is proven by the staked agent's signature; reuse and silence
  are caught, but an agent willing to lose its stake could sign one false bank reference.
  Production: bank / UPI webhook signatures or zkTLS proofs.
- **Field-partner collusion.** A partner colluding with an NGO could issue cards to fake people.
  Production: several partners per region, audits, slashing the partner when a challenge is upheld.
- **Card-list squatting.** Lists are keyed by root; a staked rogue partner could front-run an
  attestation. Production: key lists by (partner, root).
- **Sybil voting.** An NGO could donate to itself from another wallet to sway a challenge vote;
  the quorum rule raises the cost. Production: per-lot donor veto.
- **Repeat beneficiaries.** Unlinkable reusable cards need zero-knowledge membership proofs.
- **Bonds and stakes** cannot be withdrawn yet.
- **Local chains and public dev keys.** The seeded accounts use Hardhat's published mnemonic and
  published passwords — never reuse them on a real network.

## Reporting a vulnerability

Please open a private security advisory on the GitHub repository (Security → Report a vulnerability)
rather than a public issue, with steps to reproduce.
