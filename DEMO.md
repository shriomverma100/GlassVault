# Demo script — 3 minutes

Before going on stage: `npm start`, open http://localhost:5173, browser zoom 90% on the projector.
Keep a second tab on **Watchtower**. Back-up: `e2e/shots/` has screenshots of every screen.

## 0:00 – 0:20 · Hook (Explore page)
> "Donors give billions to NGOs. Once the money enters the NGO's wallet, it enters a black hole —
> the NGO grades its own homework. We built the opposite: a **GlassVault**."

Point at the Sankey: *"Every rupee you see here is held by a contract, not a person."*

## 0:20 – 1:00 · The honest path (4 roots)
1. Role **Priya** → **Donate** → Asha Foundation · Water · ₹5,000 → *Donate*.
   > "Root one: my money is a tagged lot. Root two: it is locked in escrow under rules no admin can override."
2. Lands on her **Passport**. Point at the Proof Spine.
3. Open **Donation #0** (seeded): all four nodes yellow.
   > "Root three: the vendor signed this invoice — the contract checks the signature and a global
   > nullifier. Root four: three beneficiaries scanned their QR cards; only then was the last 30% paid.
   > Their names never touch the chain — just a Merkle proof."
4. Click **See the math** — nullifier, file CID, Merkle root, tx hashes.

## 1:00 – 2:00 · The attack (Watchtower → Red team)
> "Now let's be the corrupt NGO, Shadow Trust."

Click **Run** on each step and narrate:
1. *Register shell vendor* — "legal on its own."
2. *Submit doctored photo* — "same photo as a real receipt, new number. Every on-chain check passes…"
   → scroll up: **the watcher bot challenged it by itself** (Challenge court).
3. *Resubmit duplicate* — "re-scanned invoice → nullifier collision → flag one." (Receipt Graveyard)
4. *Forge signature* — "flag two →" **Freeze Frame** fills the screen.
   > "No human pressed a button. The contract froze the escrow."
5. *Donors' verdict* — "The donors whose money was at stake upheld the challenge. Shadow Trust's bond
   and the shell vendor's stake were paid to whoever caught them."

**Killer move (if time):** switch role to **Asha Foundation**, open the **NGO** console and hand a
judge the mouse: "Try to steal." Let them raise the amount on invoice MC-311 — the live pre-check
turns black — and press **Submit anyway** → the contract records a forged-signature flag on-chain.

## 2:00 – 2:30 · Proof at scale
Click **Run 100-receipt benchmark** (~25 s — start it during step 5 narration).
> "100 receipts, 30% fraudulent — duplicates, altered amounts, forged signatures, shell vendors,
> doctored photos. 30 out of 30 caught. Zero false alarms on 70 genuine receipts."

## 2:30 – 3:00 · Close
- Report Reconciler → *Load example* → *Reconcile*: "₹40,000 invoice sold to donors as ₹80,000 of impact — 200%."
- > "Money moves only when proof moves. Proof can't be forged without the vendor's key, can't be
  > reused because of nullifiers, and can't expose the poor because of Merkle privacy.
  > And if an NGO lies, it doesn't just get caught — it pays the person who caught it."

## If something breaks
- Page stuck "Connecting to the chain…" → backend down: Ctrl+C and `npm start` again (~40 s, fully re-seeded).
- Attack already run → `npm start` again for a fresh chain.
- Judges ask about limitations → README "Honest limitations" — answer them directly.
