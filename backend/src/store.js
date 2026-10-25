import fs from "node:fs";
import path from "node:path";
import { ethers } from "ethers";
import { CID } from "multiformats/cid";
import * as raw from "multiformats/codecs/raw";
import { sha256 } from "multiformats/hashes/sha2";
import { Jimp } from "jimp";
import { DATA_DIR } from "./config.js";

const FILES_DIR = path.join(DATA_DIR, "files");
const DB_FILE = path.join(DATA_DIR, "db.json");
fs.mkdirSync(FILES_DIR, { recursive: true });

/// Small JSON store for OFF-CHAIN metadata only (file index, invoice drafts, beneficiary trees).
/// The chain stays the source of truth for money and fraud.
const empty = { files: {}, invoices: {}, beneficiaryTrees: {}, ngoProfiles: {}, watcherFindings: [], nextInvoiceId: 1 };
export const db = fs.existsSync(DB_FILE) ? { ...empty, ...JSON.parse(fs.readFileSync(DB_FILE, "utf8")) } : structuredClone(empty);
let saveTimer;
export function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)), 50);
}

/// Content-addressed file store. Files are named by their IPFS CIDv1 (raw, sha-256), so the same
/// bytes produce the same CID as `ipfs add --cid-version 1 --raw-leaves`. The on-chain fileHash is
/// keccak256(bytes) and maps back to the CID here.
export async function putFile(buffer, { name = "file", mime = "application/octet-stream" } = {}) {
  const digest = await sha256.digest(buffer);
  const cid = CID.create(1, raw.code, digest).toString();
  const fileHash = ethers.keccak256(buffer);
  fs.writeFileSync(path.join(FILES_DIR, cid), buffer);

  let dhash = null;
  if (mime.startsWith("image/")) dhash = await differenceHash(buffer).catch(() => null);

  db.files[fileHash] = { cid, fileHash, name, mime, size: buffer.length, dhash, storedAt: Date.now() };
  save();
  return db.files[fileHash];
}

/// Content type from the file's magic bytes — the client's declared type is never trusted.
export function sniffMime(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0x89 && buf.toString("latin1", 1, 4) === "PNG") return "image/png";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.toString("latin1", 0, 4) === "RIFF" && buf.toString("latin1", 8, 12) === "WEBP") return "image/webp";
  if (buf.toString("latin1", 0, 5) === "%PDF-") return "application/pdf";
  return null;
}

export function getFileByCid(cid) {
  const p = path.join(FILES_DIR, cid);
  if (!/^[a-z0-9]+$/i.test(cid) || !fs.existsSync(p)) return null;
  const meta = Object.values(db.files).find((f) => f.cid === cid);
  return { buffer: fs.readFileSync(p), meta };
}

/// 256-bit difference hash (dHash, 16×16). Survives re-scans, resizes, re-compression and small edits,
/// so a re-photographed receipt still matches the original.
export async function differenceHash(buffer) {
  const img = await Jimp.read(buffer);
  // blur first so printed text (which a forger edits) matters less than the photo itself
  img.greyscale().resize({ w: 64, h: 64 }).blur(1).resize({ w: 17, h: 16 });
  let bits = "";
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const left = img.getPixelColor(x, y) >>> 24;
      const right = img.getPixelColor(x + 1, y) >>> 24;
      bits += left > right ? "1" : "0";
    }
  }
  return BigInt("0b" + bits).toString(16).padStart(64, "0");
}

export function hamming(a, b) {
  let x = BigInt("0x" + a) ^ BigInt("0x" + b);
  let n = 0;
  while (x) {
    n += Number(x & 1n);
    x >>= 1n;
  }
  return n;
}
