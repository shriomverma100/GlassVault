import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import { ethers } from "ethers";
import { useApp, useRerenderAt, payoutBoundaries } from "../lib/store";
import { api, ipfsUrl } from "../lib/api";
import { labeler, lotPayouts, lotSpent, lotSpine, eventSentence, eventTone } from "../lib/derive";
import { fadeUp, liquid, stagger } from "../lib/motion";
import { Section, Card, Button, Input, Segmented, StatusBadge, Rupees, HashText, Countdown, Empty, Drawer, KV } from "../components/ui/kit";
import { IconOrb } from "../components/ui/primitives";
import ProofSpine from "../components/ProofSpine";
import Journey from "../components/Journey";
import ConfidenceChain from "../components/ConfidenceChain";
import { Donut } from "../components/viz";
import { inr } from "../lib/format";
import { pct } from "../lib/format";
import { CategoryIcon, BridgeIcon, VaultIcon, GavelIcon, RefundIcon, CheckIcon, CrossIcon, InvoiceIcon, ScaleIcon } from "../components/icons";

export default function Passport() {
  const { lotId } = useParams();
  return lotId === undefined ? <LotList /> : <LotDetail lotId={Number(lotId)} />;
}

// ───────────────────────── list ─────────────────────────

function LotList() {
  const { state, address, config } = useApp("state", "address", "config");
  const mine = state.lots.filter((l) => l.donor.toLowerCase() === address?.toLowerCase());
  const [scope, setScope] = useState(mine.length ? "mine" : "all");
  const label = useMemo(() => labeler(config), [config]);
  const lots = (scope === "mine" ? mine : state.lots).slice().reverse();

  return (
    <motion.div variants={stagger(0.06)} initial="hidden" animate="show">
      <motion.section variants={fadeUp} className="flex flex-wrap items-end justify-between gap-6 pt-10 pb-8">
        <div>
          <span className="text-[13px] text-graphite">Donation passports</span>
          <h1 className="font-display text-[64px] leading-[0.95] font-normal tracking-tight">Follow every rupee</h1>
        </div>
        <Segmented
          id="scope"
          value={scope}
          onChange={setScope}
          options={[
            { value: "mine", label: `My donations · ${mine.length}` },
            { value: "all", label: `All lots · ${state.lots.length}` },
          ]}
        />
      </motion.section>
      <motion.div variants={fadeUp} data-tour="passport-list" className="border-t border-hairline">
        {lots.length === 0 ? (
          <div className="py-8">
            <Empty>
              No donations yet for this wallet. <Link to="/donate" className="underline">Make one</Link>.
            </Empty>
          </div>
        ) : (
          lots.map((l) => {
            const ngo = state.ngos[l.ngoId];
            const spine = lotSpine(l, ngo, lotPayouts(state, l.id));
            return (
              <Link key={l.id} to={`/passport/${l.id}`}>
                <motion.div whileHover={{ x: 4 }} transition={liquid} className="grid grid-cols-[64px_1.4fr_1fr_1fr_160px] items-center gap-4 border-b border-hairline py-5">
                  <IconOrb>
                    <CategoryIcon category={l.category} />
                  </IconOrb>
                  <div>
                    <div className="text-[13px] text-graphite">
                      Lot #{l.id} · {label(l.donor)}
                      {l.sourceChain !== config.chainA.chainId && " · bridged"}
                    </div>
                    <div className="font-display text-[22px] font-normal">
                      {l.category} · {ngo?.name}
                    </div>
                    {l.confidence?.score != null && (
                      <div className="mt-1 text-[13px] text-ash">
                        Proof confidence <span className="font-medium text-obsidian tabular">{pct(l.confidence.score)}</span>
                        {l.confidence.provisional && " · provisional"}
                      </div>
                    )}
                  </div>
                  <div>
                    <div className="text-[13px] text-graphite">Donated</div>
                    <Rupees value={l.amount} className="font-display text-[22px] font-normal" />
                  </div>
                  <div>
                    <div className="text-[13px] text-graphite">Still in escrow</div>
                    <Rupees value={l.remaining} className="font-display text-[22px] font-normal" />
                  </div>
                  <MiniSpine statuses={spine} />
                </motion.div>
              </Link>
            );
          })
        )}
      </motion.div>
    </motion.div>
  );
}

function MiniSpine({ statuses }) {
  return (
    <div className="flex items-center">
      {statuses.map((s, i) => (
        <span key={i} className="flex items-center">
          {i > 0 && <span className={`h-px w-5 ${statuses[i - 1] === "done" && s === "done" ? "bg-signal-deep" : "bg-hairline"}`} />}
          <span
            className={`h-4 w-4 rounded-full ${
              s === "done" ? "bg-signal" : s === "pending" ? "border-2 border-signal-deep bg-white" : s === "fraud" ? "hatch bg-obsidian" : s === "disputed" ? "border-2 border-dashed border-obsidian bg-white" : s === "frozen" ? "bg-obsidian" : "border border-hairline bg-paper"
            }`}
          />
        </span>
      ))}
    </div>
  );
}

// ───────────────────────── detail ─────────────────────────

function LotDetail({ lotId }) {
  const { state, config, address, c, tx, chainNow } = useApp("state", "config", "address", "c", "tx", "chainNow");
  useRerenderAt([...payoutBoundaries(state.payouts), state.lots[Number(lotId)]?.deadline]);
  const label = useMemo(() => labeler(config), [config]);
  const [passport, setPassport] = useState(null);
  const [votes, setVotes] = useState({});
  const [mathOpen, setMathOpen] = useState(false);
  const [evidence, setEvidence] = useState({});

  const lot = state.lots[lotId];
  const ngo = lot && state.ngos[lot.ngoId];
  const payouts = useMemo(() => (lot ? lotPayouts(state, lotId) : []), [state, lot, lotId]);
  const isDonor = lot && address && lot.donor.toLowerCase() === address.toLowerCase();

  useEffect(() => {
    api.get(`/api/passport/${lotId}`).then(setPassport).catch(() => setPassport(null));
  }, [lotId, state.updatedAt]);

  // which challenged payouts this wallet already voted on
  useEffect(() => {
    if (!c || !address) return;
    const challenged = payouts.filter((p) => p.status === "Challenged");
    Promise.all(challenged.map((p) => c.vault.hasVoted(p.id, address).then((v) => [p.id, v]))).then((rows) => setVotes(Object.fromEntries(rows)));
  }, [c, address, payouts]);

  if (!lot) return <div className="py-16"><Empty>Lot #{lotId} doesn't exist yet.</Empty></div>;

  const now = chainNow();
  const spine = lotSpine(lot, ngo, payouts);
  const bridged = lot.sourceChain !== config.chainA.chainId;
  const spent = payouts.reduce((a, p) => a + lotSpent(p), 0);
  const canReclaim = isDonor && lot.remaining > 0 && (ngo.frozen || now > lot.deadline);
  // dead-man switch: an expired lot with a fallback NGO can be moved there by anyone signed in
  const fallback = lot.fallbackNgoId != null ? state.ngos[lot.fallbackNgoId] : null;
  const expired = lot.remaining > 0 && (ngo.frozen || now > lot.deadline);
  const canRedirect = expired && fallback && !fallback.frozen && lot.redirectedTo == null && !!address;
  const latest = (pred) => payouts.find(pred);
  const pending = latest((p) => p.status === "Pending");
  const released = latest((p) => p.status === "Released");
  const completed = payouts.filter((p) => p.status === "Completed");

  const run = (label, fn) => tx(label, fn).catch(() => {});

  async function challenge(p) {
    const bond = await c.vault.CHALLENGE_BOND();
    const vaultAddr = c.vault.target;
    if ((await c.dinr.allowance(address, vaultAddr)) < bond) await tx("Approve ₹500 challenge bond", () => c.dinr.approve(vaultAddr, bond));
    const text = evidence[p.id] || "Disputed by donor";
    await tx(`Challenge payout #${p.id}`, () => c.vault.challenge(p.id, ethers.id(text), ""));
  }

  const spineSteps = [
    {
      status: spine[0],
      detail: (
        <Detail title={<Rupees value={lot.amount} />} sub={`${label(lot.donor)} · ${bridged ? `bridged from chain ${lot.sourceChain}` : `chain ${lot.sourceChain}`}`} />
      ),
    },
    {
      status: spine[1],
      detail: (
        <Detail
          title={ngo.frozen ? "Frozen" : <Rupees value={lot.remaining} />}
          sub={ngo.frozen ? "Contract froze this NGO · reclaim open" : `in escrow · proof due in `}
          extra={!ngo.frozen && <Countdown until={lot.deadline} done="deadline passed" />}
        />
      ),
    },
    {
      status: spine[2],
      detail: pending ? (
        <Detail title={<Rupees value={pending.share} />} sub="invoice signed · window closes in " extra={<Countdown until={pending.releaseAt} done="now — releasable" />} />
      ) : payouts.length ? (
        <Detail title={<Rupees value={spent} />} sub={`${payouts.length} invoice${payouts.length > 1 ? "s" : ""} charged to this lot`} />
      ) : (
        <Detail title="—" sub="No invoice yet" />
      ),
    },
    {
      status: spine[3],
      detail: released ? (
        <Detail title={`${released.deliveries}/${released.deliveriesRequired}`} sub="beneficiaries proved delivery" />
      ) : completed.length ? (
        <Detail title={`${completed.reduce((a, p) => a + p.deliveries, 0)} proofs`} sub={`${completed.length} payout${completed.length > 1 ? "s" : ""} impact-verified`} />
      ) : (
        <Detail title="—" sub="Waiting for deliveries" />
      ),
    },
  ];

  return (
    <motion.div variants={stagger(0.07)} initial="hidden" animate="show">
      <motion.section variants={fadeUp} className="flex flex-wrap items-end justify-between gap-8 pt-10 pb-4">
        <div className="flex items-end gap-5">
          <IconOrb size={64}>
            <CategoryIcon category={lot.category} size={28} />
          </IconOrb>
          <div>
            <Link to="/passport" className="text-[13px] text-graphite hover:text-obsidian">
              ← All passports
            </Link>
            <h1 className="font-display text-[56px] leading-[0.95] font-normal tracking-tight">
              Donation #{lot.id}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[14px] text-ash">
              <span>{lot.category}</span>·<span>{ngo.name}</span>·<span>by {label(lot.donor)}</span>
              {bridged && (
                <span className="ml-2 inline-flex h-7 items-center gap-1.5 rounded-full border border-hairline bg-white px-3 text-[13px]">
                  <BridgeIcon size={14} /> chain {lot.sourceChain} → {config.chainA.chainId}
                </span>
              )}
              {ngo.frozen && <StatusBadge status="Frozen" />}
            </div>
          </div>
        </div>
        <div className="flex items-end gap-10">
          <Big k="Donated" v={lot.amount} />
          <Big k="Spent" v={spent} />
          <Big k="In escrow" v={lot.remaining} />
          <Button variant="ghost" onClick={() => setMathOpen(true)}>
            <ScaleIcon size={16} /> See the math
          </Button>
        </div>
      </motion.section>

      <motion.div variants={fadeUp} data-tour="passport-spine" className="border-t border-hairline">
        <ProofSpine steps={spineSteps} />
      </motion.div>

      <motion.div variants={fadeUp}>
        <Section tour="passport-glance" eyebrow="This donation at a glance" title="Where every rupee is right now">
          <Donut
            format={inr}
            center={{ value: inr(lot.amount), label: "donated" }}
            parts={[
              { label: "Committed to payouts", value: spent, tone: "signal" },
              { label: "Still in escrow", value: lot.remaining, tone: "pending" },
              { label: lot.redirectedTo != null ? "Moved to fallback NGO" : "Returned to donor", value: Math.max(0, lot.amount - spent - lot.remaining), tone: "neutral" },
            ]}
          />
        </Section>
      </motion.div>

      {lot.confidence && (
        <motion.div variants={fadeUp}>
          <Section tour="passport-confidence" eyebrow="How sure can you be? Evidence per stage" title="Probabilistic evaluation chain">
            <ConfidenceChain confidence={lot.confidence} lotId={lot.id} />
          </Section>
        </motion.div>
      )}

      <motion.div variants={fadeUp}>
        <Section tour="passport-journey" eyebrow="Every hop, every chain, every rupee" title="Journey of this donation">
          <Journey lot={lot} payouts={payouts} trail={passport?.trail ?? []} label={label} config={config} now={now} ngos={state.ngos} />
        </Section>
      </motion.div>

      <motion.div variants={fadeUp}>
        <Card className="mb-8 flex flex-wrap items-center justify-between gap-4 p-6">
          <div>
            <div className="text-[13px] font-medium text-ash">If this NGO is frozen or misses the deadline</div>
            <div className="mt-1 text-[16px]">
              {lot.redirectedTo != null ? (
                <>
                  Moved to {fallback?.name} as{" "}
                  <Link to={`/passport/${lot.redirectedTo}`} className="font-medium underline underline-offset-4">
                    donation #{lot.redirectedTo}
                  </Link>
                </>
              ) : fallback ? (
                <>Fallback: unspent funds move to {fallback.name}</>
              ) : (
                <>Refund to donor</>
              )}
            </div>
            {lot.redirectedFrom != null && (
              <div className="mt-1 text-[14px] text-ash">
                This donation arrived from{" "}
                <Link to={`/passport/${lot.redirectedFrom}`} className="underline underline-offset-4">
                  donation #{lot.redirectedFrom}
                </Link>{" "}
                as its fallback.
              </div>
            )}
          </div>
          {canRedirect && (
            <Button variant="signal" onClick={() => run(`Move unspent ₹${lot.remaining.toLocaleString("en-IN")} to ${fallback.name}`, () => c.vault.redirect(lot.id))}>
              Move unspent <Rupees value={lot.remaining} /> to {fallback.name}
            </Button>
          )}
        </Card>
      </motion.div>

      {(canReclaim || (isDonor && ngo.frozen)) && (
        <motion.div variants={fadeUp}>
          <Card className="mb-8 flex flex-wrap items-center justify-between gap-4 p-6">
            <div className="flex items-center gap-4">
              <IconOrb dark>
                <RefundIcon />
              </IconOrb>
              <div>
                <div className="font-display text-[20px] font-medium">{ngo.frozen ? "This NGO was frozen by the contract" : "Proof deadline passed"}</div>
                <div className="text-[14px] text-ash">
                  You can take back <Rupees value={lot.remaining} /> that was never spent.
                  {ngo.frozen && " Unpaid parts of open payouts can be returned to your lot first."}
                </div>
              </div>
            </div>
            <Button variant="signal" disabled={!canReclaim} onClick={() => run(`Reclaim ₹${lot.remaining.toLocaleString("en-IN")}`, () => c.vault.reclaim(lot.id))}>
              <RefundIcon size={16} /> Reclaim
            </Button>
          </Card>
        </motion.div>
      )}

      <motion.div variants={fadeUp}>
        <Section eyebrow="Where your money is now" title="Payouts from this lot">
          <div className="flex flex-col">
            {payouts.length === 0 && <Empty>Nothing spent yet — all of it is still in escrow.</Empty>}
            {payouts.map((p) => {
              const inWindow = p.status === "Pending" && now < p.releaseAt;
              const releasable = p.status === "Pending" && now >= p.releaseAt && !ngo.frozen;
              const ch = p.challenge;
              const votingOpen = p.status === "Challenged" && ch && now < ch.voteEnd;
              const resolvable = p.status === "Challenged" && ch && now >= ch.voteEnd;
              const unwindable = ngo.frozen && (p.status === "Pending" || p.status === "Released");
              return (
                <div key={p.id} className="grid grid-cols-[96px_1fr_auto] items-start gap-6 border-b border-hairline py-6 last:border-b-0">
                  {p.file?.cid && p.file.mime?.startsWith("image/") ? (
                    <a href={ipfsUrl(p.file.cid)} target="_blank" rel="noreferrer" className="block h-[120px] w-[96px] overflow-hidden rounded-[14px] border border-hairline bg-white">
                      <img src={ipfsUrl(p.file.cid)} alt={`Receipt for payout ${p.id}`} className="h-full w-full object-cover" />
                    </a>
                  ) : (
                    <div className="grid h-[120px] w-[96px] place-items-center rounded-[14px] border border-dashed border-hairline text-graphite">
                      <InvoiceIcon size={24} />
                    </div>
                  )}
                  <div>
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="font-display text-[24px] font-normal">
                        <Rupees value={p.share} />
                      </span>
                      <span className="text-[13px] text-graphite">
                        of <Rupees value={p.amount} /> · payout #{p.id}
                      </span>
                      <StatusBadge status={p.status === "Cancelled" && ch?.upheld ? "Fraud" : p.status} label={p.status === "Cancelled" && ch?.upheld ? "Fraud proven · refunded" : undefined} />
                    </div>
                    <div className="mt-1 text-[14px] text-ash">
                      to <span className="text-obsidian">{label(p.vendor)}</span>
                      {p.invoice && <> · invoice {p.invoice.invoiceNo}</>} · paid <Rupees value={p.paid} /> · {p.deliveries}/{p.deliveriesRequired} deliveries
                    </div>
                    {inWindow && (
                      <div className="mt-2 text-[13px] text-ash">
                        Challenge window closes in <Countdown until={p.releaseAt} />
                      </div>
                    )}
                    {ch && (
                      <div className="mt-3 max-w-[520px] rounded-[var(--radius-tile)] border border-hairline bg-white p-4 text-[13px]">
                        <div className="flex items-center justify-between">
                          <span className="flex items-center gap-2">
                            <GavelIcon size={16} /> Challenged by {label(ch.challenger)}
                          </span>
                          {ch.resolved ? <span className="font-medium">{ch.upheld ? "Upheld" : "Rejected"}</span> : <span className="text-graphite">vote ends in <Countdown until={ch.voteEnd} /></span>}
                        </div>
                        <VoteBar uphold={ch.votesUphold} reject={ch.votesReject} total={p.amount} />
                        {ch.evidenceURI && (
                          <a className="mt-2 inline-block font-mono text-[13px] text-ash underline" href={ch.evidenceURI.replace("ipfs://", "/ipfs/")} target="_blank" rel="noreferrer">
                            evidence {ch.evidenceURI.slice(0, 22)}…
                          </a>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    {inWindow && (
                      <div className="flex items-center gap-2">
                        <Input placeholder="Why is this wrong?" value={evidence[p.id] ?? ""} onChange={(e) => setEvidence((x) => ({ ...x, [p.id]: e.target.value }))} className="w-[220px]" />
                        <Button variant="primary" onClick={() => challenge(p).catch(() => {})}>
                          <GavelIcon size={16} /> Challenge · ₹500 bond
                        </Button>
                      </div>
                    )}
                    {releasable && (
                      <Button variant="signal" onClick={() => run(`Release 70% of payout #${p.id}`, () => c.vault.release(p.id))}>
                        <VaultIcon size={16} /> Release
                      </Button>
                    )}
                    {votingOpen && isDonor && !votes[p.id] && (
                      <div className="flex gap-2">
                        <Button variant="primary" onClick={() => run(`Uphold challenge on #${p.id}`, () => c.vault.vote(p.id, true))}>
                          <CrossIcon size={16} /> Uphold · it's fraud
                        </Button>
                        <Button variant="ghost" onClick={() => run(`Reject challenge on #${p.id}`, () => c.vault.vote(p.id, false))}>
                          <CheckIcon size={16} /> Reject
                        </Button>
                      </div>
                    )}
                    {votingOpen && isDonor && votes[p.id] && <span className="text-[13px] text-graphite">You voted</span>}
                    {resolvable && (
                      <Button variant="signal" onClick={() => run(`Resolve challenge on #${p.id}`, () => c.vault.resolve(p.id))}>
                        <GavelIcon size={16} /> Resolve
                      </Button>
                    )}
                    {unwindable && (
                      <Button variant="ghost" onClick={() => run(`Return unpaid part of #${p.id}`, () => c.vault.unwindFrozen(p.id))}>
                        <RefundIcon size={16} /> Return unpaid to donors
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
            {lot.remaining > 0 && (
              <div className="grid grid-cols-[96px_1fr] items-center gap-6 border-t border-hairline py-6">
                <div className="grid h-[72px] w-[96px] place-items-center rounded-[14px] border border-hairline bg-white">
                  <VaultIcon size={24} />
                </div>
                <div>
                  <span className="font-display text-[24px] font-normal">
                    <Rupees value={lot.remaining} />
                  </span>
                  <span className="ml-3 text-[14px] text-ash">{ngo.frozen ? "locked · reclaimable by you" : "still in escrow, untouched"}</span>
                </div>
              </div>
            )}
          </div>
        </Section>
      </motion.div>

      <motion.div variants={fadeUp}>
        <Section eyebrow="Every on-chain event for this donation" title="Trail">
          <Trail events={passport?.trail ?? []} label={label} state={state} />
        </Section>
      </motion.div>

      <Drawer open={mathOpen} onClose={() => setMathOpen(false)} title={`The math · lot #${lot.id}`}>
        <div className="mb-6">
          <div className="mb-2 text-[13px] text-graphite">Lot</div>
          <KV k="Lot id">{lot.id}</KV>
          <KV k="Donor">
            <HashText value={lot.donor} />
          </KV>
          <KV k="Source chain">{lot.sourceChain}</KV>
          <KV k="Category">{lot.category}</KV>
          <KV k="Proof deadline">{new Date(lot.deadline * 1000).toLocaleString("en-IN")}</KV>
          <KV k="Fallback">{fallback ? `${fallback.name} (NGO #${fallback.id})` : "refund to donor"}</KV>
        </div>
        {payouts.map((p) => (
          <div key={p.id} className="mb-6">
            <div className="mb-2 text-[13px] text-graphite">Payout #{p.id}</div>
            <KV k="Invoice nullifier">
              <HashText value={p.nullifier} n={6} />
            </KV>
            <KV k="File hash (keccak)">
              <HashText value={p.fileHash} n={6} />
            </KV>
            <KV k="IPFS CID">
              {p.file?.cid ? (
                <a className="font-mono text-[13px] underline" href={ipfsUrl(p.file.cid)} target="_blank" rel="noreferrer">
                  {p.file.cid.slice(0, 12)}…
                </a>
              ) : (
                "—"
              )}
            </KV>
            <KV k="Beneficiary list fingerprint (Merkle root)">
              <HashText value={p.beneficiaryRoot} n={6} />
            </KV>
            <KV k="Deliveries">
              {p.deliveries}/{p.deliveriesRequired}
            </KV>
            <KV k="Vendor">
              <HashText value={p.vendor} />
            </KV>
            <KV k="This lot's share">
              <Rupees value={p.share} /> of <Rupees value={p.amount} />
            </KV>
          </div>
        ))}
        <div>
          <div className="mb-2 text-[13px] text-graphite">Transactions</div>
          {(passport?.trail ?? []).map((e) => (
            <KV key={e.id} k={e.name}>
              <HashText value={e.tx} n={6} />
            </KV>
          ))}
        </div>
      </Drawer>
    </motion.div>
  );
}

function Detail({ title, sub, extra }) {
  return (
    <Card className="p-4 text-center">
      <div className="font-display text-[22px] leading-tight font-normal">{title}</div>
      <div className="mt-1 text-[13px] text-graphite">
        {sub}
        {extra}
      </div>
    </Card>
  );
}

function Big({ k, v }) {
  return (
    <div>
      <div className="text-[13px] text-graphite">{k}</div>
      <Rupees value={v} className="font-display text-[32px] leading-none font-normal" />
    </div>
  );
}

function VoteBar({ uphold, reject, total }) {
  const pu = Math.min(100, (100 * uphold) / total);
  const pr = Math.min(100 - pu, (100 * reject) / total);
  return (
    <div className="mt-3">
      <div className="relative flex h-2 w-full overflow-hidden rounded-full bg-bone">
        <motion.div className="hatch h-full bg-obsidian" initial={{ width: 0 }} animate={{ width: `${pu}%` }} transition={liquid} />
        <motion.div className="h-full bg-signal" initial={{ width: 0 }} animate={{ width: `${pr}%` }} transition={liquid} />
        <span className="absolute top-0 left-1/2 h-full w-px bg-obsidian" title="Quorum: half of the payout's funding" />
      </div>
      <div className="mt-1.5 flex justify-between text-[13px] text-graphite">
        <span>
          Uphold <Rupees value={uphold} />
        </span>
        <span>quorum 50%</span>
        <span>
          Reject <Rupees value={reject} />
        </span>
      </div>
    </div>
  );
}

function Trail({ events, label, state }) {
  if (!events.length) return <Empty>No events yet.</Empty>;
  return (
    <ol className="relative ml-3 border-l border-hairline">
      {events.map((e, i) => {
        const tone = eventTone(e.name);
        return (
          <motion.li key={e.id} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ ...liquid, delay: 0.03 * i }} className="relative pb-5 pl-6 last:pb-0">
            <span className={`absolute top-1.5 -left-[6px] h-[11px] w-[11px] rounded-full ${tone === "bad" ? "hatch bg-obsidian" : tone === "good" ? "bg-signal ring-1 ring-signal-deep" : "border border-hairline bg-white"}`} />
            <div className="text-[14px]">{eventSentence(e, label, state)}</div>
            <div className="mt-0.5 flex gap-3 text-[13px] text-graphite">
              <span>{new Date(e.time * 1000).toLocaleString("en-IN")}</span>
              <span>block {e.block}</span>
              <HashText value={e.tx} />
            </div>
          </motion.li>
        );
      })}
    </ol>
  );
}
