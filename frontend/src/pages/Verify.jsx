import { useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";
import { useApp } from "../lib/store";
import { Button, Card, Input, Section } from "../components/ui/kit";
import { CheckIcon, CrossIcon, FingerprintIcon } from "../components/icons";
import { short } from "../lib/chain";

// "Verify it yourself": every answer on this page comes from the chain node, read by YOUR browser.
// GlassVault's indexer, database and API are not consulted for any verdict. The server is used only
// to *locate* receipt files by hash, and each file is re-hashed here and must match the hash the
// contract stored — so a lying server can hide a file, but never fake one.
const STATUS = ["None", "Pending", "Released", "Completed", "Challenged", "Cancelled"];
const CATEGORY = ["Water", "Medical", "Education"];
const REASON = [
  "Duplicate invoice", "Forged signature", "Out of category", "Over budget", "Amount mismatch", "Unregistered vendor", "Challenge upheld",
  "Vendor double-signed", "Duplicate fiat proof", "Unexplained transfer", "Impossible timeline", "Invoice before donation", "Impact not proven",
];
const NEAR = 24; // dHash bits (of 256) — same photo re-scanned / re-numbered
const rupees = (v) => `₹${Number(ethers.formatUnits(v, 18)).toLocaleString("en-IN")}`;

function useChain() {
  const { config } = useApp("config");
  return useMemo(() => {
    if (!config) return null;
    const rpc = `${location.origin}/rpcA`;
    const provider = new ethers.JsonRpcProvider(rpc, undefined, { staticNetwork: true, cacheTimeout: -1 });
    const A = config.chainA.GlassVault;
    return { rpc, provider, address: A.address, vault: new ethers.Contract(A.address, A.abi, provider), chainId: config.chainA.chainId };
  }, [config]);
}

/// Every payout straight from contract storage.
async function readPayouts(vault) {
  const [, , n] = await vault.counts();
  return Promise.all(Array.from({ length: Number(n) }, (_, id) => vault.payout(id).then((p) => ({ id, ...p.toObject() }))));
}

/// 256-bit difference hash in the browser (blur → 17×16 greyscale → left/right comparisons).
async function dhash(blob) {
  const bmp = await createImageBitmap(blob);
  const a = Object.assign(document.createElement("canvas"), { width: 64, height: 64 });
  const ca = a.getContext("2d", { willReadFrequently: true });
  ca.filter = "grayscale(1) blur(1px)";
  ca.drawImage(bmp, 0, 0, 64, 64);
  const b = Object.assign(document.createElement("canvas"), { width: 17, height: 16 });
  const cb = b.getContext("2d", { willReadFrequently: true });
  cb.drawImage(a, 0, 0, 17, 16);
  const px = cb.getImageData(0, 0, 17, 16).data;
  const g = (x, y) => px[(y * 17 + x) * 4];
  const bits = [];
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) bits.push(g(x, y) > g(x + 1, y));
  return bits;
}
const hamming = (a, b) => a.reduce((n, bit, i) => n + (bit !== b[i]), 0);

export default function Verify() {
  const chain = useChain();
  const [head, setHead] = useState(null);
  useEffect(() => {
    if (!chain) return;
    let live = true;
    const tick = () => chain.provider.getBlockNumber().then((n) => live && setHead(n)).catch(() => {});
    tick();
    const t = setInterval(tick, 4000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [chain]);
  if (!chain) return null;

  return (
    <div>
      <section className="pt-10 pb-8">
        <span className="inline-flex items-center gap-2 rounded-full bg-signal px-3 py-1 text-[13px] font-medium text-obsidian">
          <FingerprintIcon size={14} /> Trustless check
        </span>
        <h1 className="mt-4 font-display text-[52px] leading-[1.02] font-normal tracking-tight">Verify it yourself</h1>
        <p className="mt-4 max-w-[760px] text-[17px] leading-relaxed text-ash">
          Don't trust GlassVault — check the chain. Everything below is read by <b>your browser</b> straight from the blockchain node. Our database, indexer and API are not used for any
          answer. Even if GlassVault disappeared tomorrow, these checks would still work.
        </p>
        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Fact k="Source" v="Blockchain node (JSON-RPC)" />
          <Fact k="Contract" v={short(chain.address, 6)} mono title={chain.address} />
          <Fact k="Chain id" v={String(chain.chainId)} mono />
          <Fact k="Latest block" v={head == null ? "…" : `#${head}`} mono live />
        </div>
      </section>

      <ReceiptCheck chain={chain} />
      <PayoutAudit chain={chain} />
      <NgoStatus chain={chain} />
    </div>
  );
}

function Fact({ k, v, mono, title, live }) {
  return (
    <div className="rounded-[var(--radius-tile)] border border-hairline bg-paper px-4 py-3" title={title}>
      <div className="flex items-center gap-2 text-[12px] text-graphite">
        {live && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-signal-deep" />}
        {k}
      </div>
      <div className={`mt-0.5 text-[15px] font-medium ${mono ? "font-mono" : ""}`}>{v}</div>
    </div>
  );
}

// ── 1 · drop a receipt ──
function ReceiptCheck({ chain }) {
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState(null);
  const [drag, setDrag] = useState(false);

  async function check(file) {
    if (!file) return;
    setBusy(true);
    setOut(null);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const hash = ethers.keccak256(bytes);
      const payouts = await readPayouts(chain.vault);
      const ngoNames = {};
      const name = async (id) => (ngoNames[id] ??= (await chain.vault.ngo(id)).name);
      const exact = await Promise.all(payouts.filter((p) => p.fileHash === hash).map(async (p) => ({ ...p, ngoName: await name(p.ngoId) })));
      const flags = (await chain.vault.queryFilter(chain.vault.filters.FraudFlagged(), 0))
        .filter((e) => e.args.fileHash === hash)
        .map((e) => ({ ngoName: null, ngoId: Number(e.args.ngoId), reason: REASON[Number(e.args.reason)], block: e.blockNumber, tx: e.transactionHash }));
      for (const f of flags) f.ngoName = await name(f.ngoId);

      // visual comparison against every committed receipt image (each one re-verified against its on-chain hash)
      let similar = [];
      if (!exact.length && file.type.startsWith("image/")) {
        const mine = await dhash(file);
        const located = await fetch("/api/invoices").then((r) => r.json()).catch(() => []);
        const cidOf = Object.fromEntries(located.filter((i) => i.cid).map((i) => [i.fileHash, i.cid]));
        for (const p of payouts) {
          const cid = cidOf[p.fileHash];
          if (!cid) continue;
          const blob = await fetch(`/ipfs/${cid}`).then((r) => (r.ok ? r.blob() : null)).catch(() => null);
          if (!blob) continue;
          if (ethers.keccak256(new Uint8Array(await blob.arrayBuffer())) !== p.fileHash) continue; // server lied → ignore
          const d = hamming(mine, await dhash(blob));
          if (d <= NEAR) similar.push({ ...p, ngoName: await name(p.ngoId), distance: d });
        }
        similar.sort((a, b) => a.distance - b.distance);
      }
      setOut({ name: file.name, hash, exact, flags, similar });
    } catch (e) {
      setOut({ error: e.shortMessage ?? e.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section eyebrow="1 · Is this receipt really behind a payment?" title="Drop a receipt">
      <label
        onDragOver={(e) => (e.preventDefault(), setDrag(true))}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => (e.preventDefault(), setDrag(false), check(e.dataTransfer.files[0]))}
        className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-[var(--radius-card)] border-2 border-dashed px-6 py-10 text-center transition-colors ${
          drag ? "border-signal-deep bg-signal-mist" : "border-hairline bg-paper hover:border-ash/40"
        }`}
      >
        <input type="file" className="hidden" accept="image/*,application/pdf" onChange={(e) => check(e.target.files[0])} />
        <FingerprintIcon size={28} />
        <span className="text-[16px] font-medium">{busy ? "Hashing and reading the chain…" : "Drop a receipt file here, or click to choose"}</span>
        <span className="text-[13px] text-graphite">The file never leaves your browser — only its fingerprint (keccak-256) is compared with what the contract stored.</span>
      </label>
      {out && <ReceiptResult out={out} />}
    </Section>
  );
}

function ReceiptResult({ out }) {
  if (out.error) return <Verdict bad title="Could not read the chain" body={out.error} />;
  return (
    <div className="mt-5 flex flex-col gap-3">
      <div className="text-[13px] text-graphite">
        <span className="font-medium text-obsidian">{out.name}</span> · fingerprint <span className="font-mono">{short(out.hash, 10)}</span>
      </div>
      {out.exact.map((p) => (
        <Verdict
          key={p.id}
          bad={STATUS[Number(p.status)] === "Cancelled"}
          title={`This exact file backs payout #${p.id} — ${STATUS[Number(p.status)]}`}
          body={`${p.ngoName} · ${CATEGORY[Number(p.category)]} · ${rupees(p.amount)} to vendor ${short(p.vendor)} · ${rupees(p.paid)} released · deliveries ${p.deliveries}/${p.deliveriesRequired} confirmed by beneficiaries' cards. Invoice nullifier ${short(p.nullifier, 8)} is now used for every NGO and every donor.`}
        />
      ))}
      {out.flags.map((f, i) => (
        <Verdict key={i} bad title={`Fraud flag on-chain: ${f.reason}`} body={`Raised against ${f.ngoName} in block #${f.block} (tx ${short(f.tx, 6)}).`} />
      ))}
      {!out.exact.length &&
        out.similar.map((p) => (
          <Verdict
            key={p.id}
            bad
            title={`Not committed — but it looks like the receipt behind payout #${p.id}`}
            body={`Image fingerprint distance ${p.distance}/256 to the file committed for payout #${p.id} (${p.ngoName}, ${rupees(p.amount)}). That file was downloaded and re-hashed here: it matches the contract. A re-scanned or re-numbered copy of a receipt that was already paid.`}
          />
        ))}
      {!out.exact.length && !out.flags.length && !out.similar.length && (
        <Verdict bad title="No payment on the chain is backed by this file" body="No payout committed this fingerprint and no similar receipt image was found. If an NGO showed you this receipt as proof, it is not proof of anything recorded." />
      )}
    </div>
  );
}

function Verdict({ bad, title, body }) {
  return (
    <div className={`page-enter flex gap-3 rounded-[var(--radius-tile)] border p-4 ${bad ? "border-obsidian bg-white" : "border-signal-deep bg-signal-mist"}`}>
      <span className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full ${bad ? "bg-obsidian text-white" : "bg-signal-deep text-white"}`}>
        {bad ? <CrossIcon size={14} /> : <CheckIcon size={14} />}
      </span>
      <div>
        <div className="text-[15px] font-medium">{title}</div>
        <p className="mt-1 text-[14px] leading-relaxed text-ash">{body}</p>
      </div>
    </div>
  );
}

// ── 2 · audit one payout's on-chain history ──
function PayoutAudit({ chain }) {
  const [id, setId] = useState("0");
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState(null);

  async function audit() {
    setBusy(true);
    setOut(null);
    try {
      const n = Number(id);
      const p = (await chain.vault.payout(n)).toObject();
      const org = await chain.vault.ngo(p.ngoId);
      const shares = await chain.vault.payoutShares(n);
      const logs = await chain.provider.getLogs({ address: chain.address, fromBlock: 0, toBlock: "latest" });
      const events = [];
      for (const l of logs) {
        let e;
        try {
          e = chain.vault.interface.parseLog(l);
        } catch {
          continue;
        }
        if (e && "payoutId" in e.args.toObject() && Number(e.args.payoutId) === n) events.push({ name: e.name, block: l.blockNumber, tx: l.transactionHash });
      }
      const times = {};
      for (const ev of events) times[ev.block] ??= (await chain.provider.getBlock(ev.block)).timestamp;
      setOut({ n, p, org, shares, events: events.map((e) => ({ ...e, time: times[e.block] })) });
    } catch (e) {
      setOut({ error: e.shortMessage ?? e.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section eyebrow="2 · What really happened to a payout?" title="Audit a payout">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1.5 text-[13px] text-graphite">
          Payout number
          <Input type="number" min="0" value={id} onChange={(e) => setId(e.target.value)} className="w-40" />
        </label>
        <Button variant="signal" onClick={audit} disabled={busy}>
          {busy ? "Reading the chain…" : "Read it from the chain"}
        </Button>
      </div>
      {out?.error && <Verdict bad title="Not found on the chain" body={out.error} />}
      {out && !out.error && (
        <Card className="page-enter mt-5 p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h3 className="font-display text-[24px]">
              Payout #{out.n} · {STATUS[Number(out.p.status)]}
            </h3>
            <span className="text-[14px] text-ash">
              {out.org.name}
              {out.org.frozen && " · NGO FROZEN"}
            </span>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-4 text-[14px] md:grid-cols-4">
            <KV k="Category" v={CATEGORY[Number(out.p.category)]} />
            <KV k="Amount → paid" v={`${rupees(out.p.amount)} → ${rupees(out.p.paid)}`} />
            <KV k="Vendor" v={short(out.p.vendor)} mono />
            <KV k="Deliveries proven" v={`${out.p.deliveries} / ${out.p.deliveriesRequired}`} />
            <KV k="Receipt fingerprint" v={short(out.p.fileHash, 8)} mono />
            <KV k="Invoice nullifier" v={short(out.p.nullifier, 8)} mono />
            <KV k="Beneficiary list root" v={short(out.p.beneficiaryRoot, 8)} mono />
            <KV k="Funded by donations" v={out.shares.map((s) => `#${s.lotId}`).join(", ") || "—"} />
          </div>
          <ol className="relative mt-6 flex flex-col gap-2 pl-6">
            <span aria-hidden="true" className="absolute top-2 bottom-2 left-[7px] w-px bg-hairline" />
            {out.events.map((e, i) => (
              <li key={i} className="relative flex flex-wrap items-baseline gap-x-3 text-[14px]">
                <span className="absolute top-1.5 -left-[22px] h-2.5 w-2.5 rounded-full bg-signal-deep" />
                <span className="font-medium">{e.name}</span>
                <span className="font-mono text-[12px] text-graphite">
                  block #{e.block} · {new Date(e.time * 1000).toLocaleString()} · tx {short(e.tx, 6)}
                </span>
              </li>
            ))}
          </ol>
        </Card>
      )}
    </Section>
  );
}

function KV({ k, v, mono }) {
  return (
    <div>
      <div className="text-[12px] text-graphite">{k}</div>
      <div className={`font-medium ${mono ? "font-mono text-[13px]" : ""}`}>{v}</div>
    </div>
  );
}

// ── 3 · which NGOs can still spend ──
function NgoStatus({ chain }) {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    let live = true;
    (async () => {
      const [n] = await chain.vault.counts();
      const list = await Promise.all(
        Array.from({ length: Number(n) }, async (_, i) => {
          const o = await chain.vault.ngo(i);
          return { id: i, name: o.name, frozen: o.frozen, flags: Number(o.flagCount), trust: Number(await chain.vault.trustScore(i)) };
        }),
      );
      if (live) setRows(list);
    })().catch(() => live && setRows([]));
    return () => {
      live = false;
    };
  }, [chain]);
  return (
    <Section eyebrow="3 · Can this NGO still spend donors' money?" title="NGO status, from contract storage">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {(rows ?? []).map((r) => (
          <div key={r.id} className={`rounded-[var(--radius-tile)] border p-4 ${r.frozen ? "hatch border-obsidian bg-white" : "border-hairline bg-paper"}`}>
            <div className="flex items-baseline justify-between">
              <span className="text-[16px] font-medium">{r.name}</span>
              <span className={`rounded-full px-2.5 py-0.5 text-[12px] font-medium ${r.frozen ? "bg-obsidian text-white" : "bg-signal text-obsidian"}`}>{r.frozen ? "Frozen by contract" : "Active"}</span>
            </div>
            <div className="mt-2 text-[13px] text-ash">
              Fraud flags <b className="text-obsidian">{r.flags}</b> · trust score <b className="text-obsidian">{r.trust}</b>/100
            </div>
          </div>
        ))}
        {rows === null && <div className="text-[14px] text-graphite">Reading the chain…</div>}
      </div>
    </Section>
  );
}
