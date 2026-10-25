import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ethers } from "ethers";
import { useApp, useRerenderAt, payoutBoundaries } from "../../lib/store";
import { Button, Countdown, Empty, HashText, Input, Rupees, Section, StatusBadge } from "../ui/kit";
import { CategoryIcon, GavelIcon } from "../icons";
import { liquid } from "../../lib/motion";
import { ipfsHref, LinkIcon } from "./shared";

/// Challenge court: open windows anyone can dispute, live donor votes, and resolution.
export default function Court() {
  const { state, chainNow } = useApp("state", "chainNow");
  useRerenderAt(payoutBoundaries(state.payouts));
  const now = chainNow();
  const open = state.payouts.filter((p) => p.status === "Pending" && p.releaseAt > now && !state.ngos[p.ngoId]?.frozen);
  const disputed = state.payouts.filter((p) => p.challenge).sort((a, b) => Number(a.challenge.resolved) - Number(b.challenge.resolved) || b.id - a.id);

  return (
    <Section eyebrow="No auditor · donors decide · bonds at stake" title="Challenge court">
      <div className="grid grid-cols-[1fr_1.4fr] gap-8">
        <div>
          <div className="mb-3 text-[13px] text-graphite">Open challenge windows</div>
          {!open.length ? (
            <Empty>No payout is inside its challenge window right now.</Empty>
          ) : (
            <div className="flex flex-col gap-3">
              {open.map((p) => (
                <OpenPayout key={p.id} p={p} />
              ))}
            </div>
          )}
        </div>
        <div>
          <div className="mb-3 text-[13px] text-graphite">Disputes</div>
          {!disputed.length ? (
            <Empty>No payout has been challenged yet.</Empty>
          ) : (
            <div className="flex flex-col gap-3">
              {disputed.map((p) => (
                <Dispute key={p.id} p={p} />
              ))}
            </div>
          )}
        </div>
      </div>
    </Section>
  );
}

function OpenPayout({ p }) {
  const { state, c, tx, address } = useApp("state", "c", "tx", "address");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const challenge = async () => {
    setBusy(true);
    try {
      const bond = await c.vault.CHALLENGE_BOND();
      if ((await c.dinr.allowance(address, c.vault.target)) < bond) {
        await tx("Approve ₹500 challenge bond", () => c.dinr.approve(c.vault.target, ethers.MaxUint256));
      }
      await tx(`Challenge payout #${p.id}`, () => c.vault.challenge(p.id, ethers.id(note || `challenge payout ${p.id}`), ""));
      setNote("");
    } catch {
      /* toast already shown */
    } finally {
      setBusy(false);
    }
  };

  return (
    <motion.div layout transition={liquid} className="rounded-[var(--radius-tile)] border border-signal-deep bg-white p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-full bg-paper">
            <CategoryIcon category={p.category} />
          </span>
          <div>
            <div className="text-[14px] font-medium">
              Payout #{p.id} · {state.ngos[p.ngoId]?.name}
            </div>
            <div className="text-[13px] text-graphite">
              <Rupees value={p.amount} /> → <HashText value={p.vendor} />
            </div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[13px] text-graphite">window closes in</div>
          <div className="font-display text-[22px] font-normal">
            <Countdown until={p.releaseAt} done="closed" />
          </div>
        </div>
      </div>
      <div className="mt-4 flex gap-2">
        <Input placeholder="Evidence note (hashed on-chain)" value={note} onChange={(e) => setNote(e.target.value)} className="flex-1" />
        <Button variant="primary" disabled={busy} onClick={challenge}>
          <GavelIcon size={16} />
          Challenge · ₹500 bond
        </Button>
      </div>
    </motion.div>
  );
}

function Dispute({ p }) {
  const { state, c, tx, address, chainNow } = useApp("state", "c", "tx", "address", "chainNow");
  const ch = p.challenge;
  const [voted, setVoted] = useState(null);
  const [busy, setBusy] = useState(false);
  const myWeight = p.shares.filter((s) => state.lots[s.lotId]?.donor?.toLowerCase() === address?.toLowerCase()).reduce((a, s) => a + s.amount, 0);
  const votingOpen = p.status === "Challenged" && chainNow() < ch.voteEnd;
  const canResolve = p.status === "Challenged" && !ch.resolved && chainNow() >= ch.voteEnd;

  useEffect(() => {
    if (!c || !address || p.status !== "Challenged") return;
    c.vault.hasVoted(p.id, address).then(setVoted).catch(() => setVoted(null));
  }, [c, address, p.id, p.status, ch.votesUphold, ch.votesReject]);

  const run = async (label, fn) => {
    setBusy(true);
    try {
      await tx(label, fn);
    } catch {
      /* toast already shown */
    } finally {
      setBusy(false);
    }
  };

  const quorum = p.amount / 2;
  const scale = Math.max(p.amount, ch.votesUphold + ch.votesReject, 1);
  const pct = (v) => `${(100 * v) / scale}%`;

  return (
    <motion.div layout transition={liquid} className={`rounded-[var(--radius-tile)] border p-5 ${ch.resolved && ch.upheld ? "hatch border-obsidian bg-obsidian text-white" : "border-hairline bg-white"}`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-[14px] font-medium">
            Payout #{p.id} · {state.ngos[p.ngoId]?.name} · <Rupees value={p.amount} />
          </div>
          <div className={`mt-0.5 text-[13px] ${ch.resolved && ch.upheld ? "text-white/70" : "text-graphite"}`}>
            Challenged by <HashText value={ch.challenger} className={ch.resolved && ch.upheld ? "!text-white/70" : ""} />
            {ch.evidenceURI && (
              <>
                {" · "}
                <a href={ipfsHref(ch.evidenceURI)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline underline-offset-2">
                  <LinkIcon width={14} height={14} />
                  evidence
                </a>
              </>
            )}
          </div>
        </div>
        {ch.resolved ? (
          <StatusBadge status={ch.upheld ? "Fraud" : "Active"} label={ch.upheld ? "Upheld · slashed" : "Rejected · resumed"} />
        ) : votingOpen ? (
          <div className="text-right">
            <div className="text-[13px] text-graphite">voting ends in</div>
            <div className="font-display text-[22px] font-normal">
              <Countdown until={ch.voteEnd} />
            </div>
          </div>
        ) : (
          <StatusBadge status="Challenged" label="Voting closed" />
        )}
      </div>

      {/* uphold vs reject against the quorum line (half the payout's funding) */}
      <div className="mt-5">
        <div className="relative h-2 overflow-hidden rounded-full bg-paper">
          <motion.div className="absolute inset-y-0 left-0 bg-signal" initial={{ width: 0 }} animate={{ width: pct(ch.votesUphold) }} transition={liquid} />
          <motion.div className="hatch absolute inset-y-0 bg-ash" style={{ left: pct(ch.votesUphold) }} initial={{ width: 0 }} animate={{ width: pct(ch.votesReject) }} transition={liquid} />
        </div>
        <div className="relative h-0">
          <span className={`absolute -top-3.5 h-5 w-px ${ch.resolved && ch.upheld ? "bg-white" : "bg-obsidian"}`} style={{ left: pct(quorum) }} />
        </div>
        <div className={`mt-2 flex justify-between text-[13px] ${ch.resolved && ch.upheld ? "text-white/70" : "text-graphite"}`}>
          <span>
            Uphold <Rupees value={ch.votesUphold} />
          </span>
          <span>
            quorum <Rupees value={quorum} />
          </span>
          <span>
            Reject <Rupees value={ch.votesReject} />
          </span>
        </div>
      </div>

      {(votingOpen || canResolve) && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {votingOpen && myWeight > 0 && voted === false && (
            <>
              <Button variant="primary" disabled={busy} onClick={() => run(`Vote uphold on #${p.id}`, () => c.vault.vote(p.id, true))}>
                Uphold · <Rupees value={myWeight} />
              </Button>
              <Button variant="ghost" disabled={busy} onClick={() => run(`Vote reject on #${p.id}`, () => c.vault.vote(p.id, false))}>
                Reject
              </Button>
            </>
          )}
          {votingOpen && myWeight > 0 && voted && <span className="text-[13px] text-graphite">You voted.</span>}
          {votingOpen && myWeight === 0 && <span className="text-[13px] text-graphite">Only donors whose money funds this payout can vote.</span>}
          {canResolve && (
            <Button variant="signal" disabled={busy} onClick={() => run(`Resolve challenge #${p.id}`, () => c.vault.resolve(p.id))}>
              <GavelIcon size={16} />
              Resolve on-chain
            </Button>
          )}
        </div>
      )}
    </motion.div>
  );
}
