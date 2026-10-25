import { ethers } from "ethers";
import { Jimp, loadFont } from "jimp";
import { SANS_16_BLACK, SANS_32_BLACK } from "jimp/fonts";
import { chains, roleKey } from "../src/config.js";

export const API = process.env.API || "http://localhost:4000";
export const CAT = { Water: 0, Medical: 1, Education: 2 };
export const inr = (n) => ethers.parseUnits(String(n), 18);

export function setup() {
  const { depA, depB, providerA, providerB } = chains();
  // NonceManager keeps back-to-back txs from the same role from colliding
  const cache = new Map();
  const wallet = (role, provider = providerA) => {
    const key = `${role}:${provider === providerA ? "A" : "B"}`;
    if (!cache.has(key)) cache.set(key, new ethers.NonceManager(new ethers.Wallet(roleKey(role), provider)));
    return cache.get(key);
  };
  const vaultAs = (role) => new ethers.Contract(depA.GlassVault.address, depA.GlassVault.abi, wallet(role));
  const tokenA = (role) => new ethers.Contract(depA.DINR.address, depA.DINR.abi, wallet(role));
  const tokenB = (role) => new ethers.Contract(depB.DINR.address, depB.DINR.abi, wallet(role, providerB));
  const gatewayB = (role) => new ethers.Contract(depB.BridgeGateway.address, depB.BridgeGateway.abi, wallet(role, providerB));
  const address = (role) => new ethers.Wallet(roleKey(role)).address;
  return { depA, depB, providerA, providerB, wallet, vaultAs, tokenA, tokenB, gatewayB, address };
}

export async function api(path, body) {
  const res = await fetch(`${API}${path}`, body === undefined ? undefined : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json();
  if (!res.ok) throw new Error(`${path}: ${json.error}`);
  return json;
}

export async function uploadFile(buffer, name, mime = "image/png") {
  const form = new FormData();
  form.append("file", new Blob([buffer], { type: mime }), name);
  const res = await fetch(`${API}/api/files`, { method: "POST", body: form });
  return res.json();
}

// deterministic PRNG so the same seed renders the same "photo"
function rng(seed) {
  let s = Number(BigInt(ethers.id(String(seed))) % 2147483647n) || 1;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

let fonts;
/// Renders a receipt "photo": a paper sheet with uneven lighting, slight framing offset and printed
/// fields. `seed` controls the photo; re-using a seed with edited text = a doctored copy of one photo.
export async function renderReceipt({ seed, vendorName, invoiceNo, date, items, total, jitter = 0 }) {
  fonts ??= { s: await loadFont(SANS_16_BLACK), l: await loadFont(SANS_32_BLACK) };
  const r = rng(seed);
  const W = 480, H = 640;
  const img = new Jimp({ width: W, height: H, color: 0xffffffff });

  // uneven lighting: a few large soft blotches unique to this photo
  const blotches = Array.from({ length: 5 }, () => ({ x: r() * W, y: r() * H, rad: 140 + r() * 220, k: 60 + r() * 110 }));
  // fold creases (lines a·x + b·y = c) and an ink stamp — the structure that makes each photo unique
  const creases = Array.from({ length: 3 }, () => {
    const t = r() * Math.PI;
    return { a: Math.cos(t), b: Math.sin(t), c: (r() - 0.2) * 600, k: 45 + r() * 45, w: 10 + r() * 14 };
  });
  const stamp = { x: 80 + r() * 320, y: 300 + r() * 280, rad: 40 + r() * 30 };
  img.scan(0, 0, W, H, (x, y, idx) => {
    let shade = 0;
    for (const b of blotches) {
      const d = Math.hypot(x - b.x, y - b.y);
      if (d < b.rad) shade += b.k * (1 - d / b.rad);
    }
    for (const c of creases) {
      const d = Math.abs(c.a * x + c.b * y - c.c);
      if (d < c.w) shade += c.k * (1 - d / c.w);
    }
    const sd = Math.hypot(x - stamp.x, y - stamp.y);
    if (sd < stamp.rad && sd > stamp.rad - 9) shade += 110;
    const v = Math.min(255, Math.max(90, 250 - shade + jitter));
    img.bitmap.data[idx] = v;
    img.bitmap.data[idx + 1] = v;
    img.bitmap.data[idx + 2] = v - 6;
  });

  const ox = Math.floor(r() * 30), oy = Math.floor(r() * 30);
  img.print({ font: fonts.l, x: 30 + ox, y: 30 + oy, text: vendorName });
  img.print({ font: fonts.s, x: 30 + ox, y: 80 + oy, text: `Invoice ${invoiceNo}` });
  img.print({ font: fonts.s, x: 30 + ox, y: 104 + oy, text: `Date ${new Date(date * 1000).toISOString().slice(0, 10)}` });
  let y = 150 + oy;
  for (const it of items) {
    img.print({ font: fonts.s, x: 30 + ox, y, text: `${it.qty} x ${it.name}` });
    img.print({ font: fonts.s, x: 330 + ox, y, text: `Rs ${it.price.toLocaleString("en-IN")}` });
    y += 26;
  }
  img.print({ font: fonts.l, x: 30 + ox, y: y + 30, text: `TOTAL Rs ${total.toLocaleString("en-IN")}` });
  return img.getBuffer("image/png");
}

const TYPES = {
  Invoice: [
    { name: "vendor", type: "address" },
    { name: "ngoId", type: "uint256" },
    { name: "invoiceNo", type: "bytes32" },
    { name: "amount", type: "uint256" },
    { name: "date", type: "uint64" },
    { name: "category", type: "uint8" },
    { name: "fileHash", type: "bytes32" },
  ],
};

/// Signs the invoice exactly as the vendor portal does (EIP-712). `signer` can be anyone — a forger
/// signing in the vendor's name produces a signature the contract rejects.
export async function signInvoice(ctx, signer, f) {
  const domain = { name: "GlassVault", version: "1", chainId: ctx.depA.chainId, verifyingContract: ctx.depA.GlassVault.address };
  const typed = { vendor: f.vendor, ngoId: f.ngoId, invoiceNo: ethers.id(f.invoiceNo), amount: inr(f.amount), date: f.date, category: f.category, fileHash: f.fileHash };
  const signature = await new ethers.Wallet(roleKey(signer)).signTypedData(domain, TYPES, typed);
  return { typed, signature };
}

/// Moves local chain time forward (Hardhat dev RPC) so challenge windows can elapse in scripts.
export async function advance(provider, seconds) {
  await provider.send("evm_increaseTime", [seconds]);
  await provider.send("evm_mine", []);
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
