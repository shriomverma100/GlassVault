import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { ethers } from "ethers";
import { DATA_DIR } from "./config.js";

/// Accounts: OFF-CHAIN login only. The server stores a password hash and the user's wallet keystore
/// (encrypted in the browser with the user's password) — it never sees a private key and holds no funds.

export const KINDS = ["Donor", "NGO", "Vendor", "Field", "Watcher"];
const SESSION_DAYS = 7;
const scryptAsync = promisify(scrypt);
const SCRYPT = { N: 2 ** 15, r: 8, p: 1 };

const db = new DatabaseSync(path.join(DATA_DIR, "accounts.db"));
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA busy_timeout = 5000;
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    kind TEXT NOT NULL,
    display_name TEXT NOT NULL,
    address TEXT NOT NULL UNIQUE,
    keystore TEXT NOT NULL,
    funded INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
`);
// v2: wallet type. MetaMask accounts have no password and no keystore (stored as '' — the columns
// predate them and SQLite can't relax NOT NULL in place); password login can never match ''.
if (!db.prepare("PRAGMA table_info(users)").all().some((c) => c.name === "wallet")) {
  db.exec("ALTER TABLE users ADD COLUMN wallet TEXT NOT NULL DEFAULT 'keystore'");
}

const publicUser = (row) =>
  row && { id: row.id, username: row.username, kind: row.kind, displayName: row.display_name, address: row.address, wallet: row.wallet ?? "keystore", createdAt: row.created_at };

// ── passwords ──
export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, 64, { ...SCRYPT, maxmem: 128 * SCRYPT.N * SCRYPT.r * 2 });
  return ["scrypt", SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString("hex"), key.toString("hex")].join("$");
}

export async function verifyPassword(password, stored) {
  const [alg, N, r, p, saltHex, hashHex] = String(stored).split("$");
  if (alg !== "scrypt") return false;
  const expected = Buffer.from(hashHex, "hex");
  const key = await scryptAsync(password, Buffer.from(saltHex, "hex"), expected.length, { N: +N, r: +r, p: +p, maxmem: 128 * +N * +r * 2 });
  return timingSafeEqual(key, expected);
}

// A fixed dummy hash so a login for an unknown user costs the same time as a real one.
let dummyHash;
export const dummyPasswordHash = async () => (dummyHash ??= await hashPassword(randomBytes(16).toString("hex")));

// ── validation ──
/// Username / role / display name — shared by password and MetaMask sign-up.
export function validateProfile(body) {
  const username = String(body?.username ?? "").trim().toLowerCase();
  const kind = String(body?.kind ?? "");
  const displayName = String(body?.displayName ?? "").trim();
  if (!/^[a-z0-9_.-]{3,32}$/.test(username)) return { error: "Username must be 3–32 characters: a–z, 0–9, dot, dash or underscore" };
  if (!KINDS.includes(kind)) return { error: `Role must be one of ${KINDS.join(", ")}` };
  if (displayName.length < 1 || displayName.length > 60) return { error: "Display name must be 1–60 characters" };
  return { username, kind, displayName };
}

export function validateSignup(body) {
  const profile = validateProfile(body);
  if (profile.error) return profile;
  const { username, kind, displayName } = profile;
  const password = String(body?.password ?? "");
  const keystore = String(body?.keystore ?? "");
  if (password.length < 8 || password.length > 128) return { error: "Password must be 8–128 characters" };
  let address;
  try {
    address = ethers.getAddress(String(body?.address ?? ""));
  } catch {
    return { error: "Invalid wallet address" };
  }
  if (keystore.length > 16 * 1024) return { error: "Keystore too large" };
  let ks;
  try {
    ks = JSON.parse(keystore);
  } catch {
    return { error: "Keystore must be JSON" };
  }
  if (String(ks?.address ?? "").toLowerCase().replace(/^0x/, "") !== address.slice(2).toLowerCase()) return { error: "Keystore does not match the wallet address" };
  if (ks.privateKey || ks.mnemonic) return { error: "Send the encrypted keystore only, never a private key" };
  return { username, password, kind, displayName, address, keystore };
}

// ── users ──
export const userByUsername = (username) => db.prepare("SELECT * FROM users WHERE username = ?").get(String(username).toLowerCase());
export const userById = (id) => db.prepare("SELECT * FROM users WHERE id = ?").get(id);
export const userByAddress = (address) => db.prepare("SELECT * FROM users WHERE address = ?").get(ethers.getAddress(address));

/// Creates an account. Returns { user } or { error, status }.
export async function createAccount({ username, password, kind, displayName, address, keystore }) {
  if (userByUsername(username)) return { error: "Username already taken", status: 409 };
  if (db.prepare("SELECT 1 FROM users WHERE address = ?").get(address)) return { error: "This wallet already has an account", status: 409 };
  const passwordHash = await hashPassword(password);
  try {
    const r = db
      .prepare("INSERT INTO users (username, password_hash, kind, display_name, address, keystore, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(username, passwordHash, kind, displayName, address, keystore, Date.now());
    return { user: publicUser(userById(Number(r.lastInsertRowid))) };
  } catch (e) {
    if (String(e.message).includes("UNIQUE")) return { error: "Username or wallet already taken", status: 409 };
    throw e;
  }
}

/// MetaMask account: the wallet lives in the user's MetaMask, so no password and no keystore here.
export function createMetaMaskAccount({ username, kind, displayName, address }) {
  if (userByUsername(username)) return { error: "Username already taken", status: 409 };
  if (db.prepare("SELECT 1 FROM users WHERE address = ?").get(address)) return { error: "This wallet already has an account", status: 409 };
  try {
    const r = db
      .prepare("INSERT INTO users (username, password_hash, kind, display_name, address, keystore, wallet, created_at) VALUES (?, '', ?, ?, ?, '', 'metamask', ?)")
      .run(username, kind, displayName, address, Date.now());
    return { user: publicUser(userById(Number(r.lastInsertRowid))) };
  } catch (e) {
    if (String(e.message).includes("UNIQUE")) return { error: "Username or wallet already taken", status: 409 };
    throw e;
  }
}

export const directory = () => db.prepare("SELECT address, display_name AS displayName, kind FROM users ORDER BY id").all();

export function markFunded(userId) {
  // atomic claim: only the first caller flips 0 → 1
  return db.prepare("UPDATE users SET funded = 1 WHERE id = ? AND funded = 0").run(userId).changes === 1;
}
export const unmarkFunded = (userId) => db.prepare("UPDATE users SET funded = 0 WHERE id = ?").run(userId);

// ── sessions ──
const sha256 = (s) => createHash("sha256").update(s).digest("hex");

export function createSession(userId) {
  const token = randomBytes(32).toString("hex");
  const expiresAt = Date.now() + SESSION_DAYS * 86400_000;
  db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)").run(sha256(token), userId, expiresAt);
  return { token, maxAge: SESSION_DAYS * 86400 };
}

export function sessionUser(token) {
  if (!token) return null;
  const row = db.prepare("SELECT u.* , s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?").get(sha256(token));
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    deleteSession(token);
    return null;
  }
  return row;
}

export const deleteSession = (token) => token && db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(sha256(token));
export const pruneSessions = () => db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(Date.now());

export { publicUser };
