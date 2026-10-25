import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(here, "..", "..");
export const DATA_DIR = path.resolve(process.env.GV_DATA_DIR || path.join(here, "..", "data"));
export const SHARED_DIR = path.resolve(process.env.GV_SHARED_DIR || path.join(ROOT_DIR, "shared"));
fs.mkdirSync(DATA_DIR, { recursive: true });

export function loadDeployment(name) {
  const file = path.join(SHARED_DIR, `deployment.${name}.json`);
  if (!fs.existsSync(file)) throw new Error(`Missing ${file} — run \`npm run deploy\` in contracts/ first`);
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export const RPC_A = process.env.RPC_A || "http://127.0.0.1:8545";
export const RPC_B = process.env.RPC_B || "http://127.0.0.1:8546";

// Local chains use the public Hardhat dev mnemonic. On any real network, set RELAYER_KEY / WATCHER_KEY.
const DEV_MNEMONIC = "test test test test test test test test test test test junk";
export const devKey = (i) => ethers.HDNodeWallet.fromPhrase(DEV_MNEMONIC, undefined, `m/44'/60'/0'/0/${i}`).privateKey;

/// Fixed role → Hardhat account index map, shared with the seed script and the frontend role switcher.
export const ROLES = {
  relayer: 0,
  ngoAsha: 1,
  ngoShadow: 2,
  vendorWater: 3,
  vendorMedical: 4,
  vendorEducation: 5,
  donorPriya: 6,
  donorRahul: 7,
  donorCSR: 8,
  watcher: 9,
  fieldWorker: 10,
  vendorShell: 11, // red-team: colluding shell vendor used by the attack script
};
export const roleKey = (role) => devKey(ROLES[role]);

export const RELAYER_KEY = process.env.RELAYER_KEY || roleKey("relayer");
export const WATCHER_KEY = process.env.WATCHER_KEY || roleKey("watcher");
// Local faucet: dINR is minted by the DINR owner (the deployer = relayer key); gas comes from an unused
// dev account (#19) so faucet sends don't race the relayer on the deployer's nonce.
export const FAUCET_GAS_KEY = process.env.FAUCET_GAS_KEY || devKey(19);

export function chains() {
  const depA = loadDeployment("chainA");
  const depB = loadDeployment("chainB");
  // polling interval 1s — local chains mine instantly
  const providerA = new ethers.JsonRpcProvider(RPC_A, undefined, { pollingInterval: 1000 });
  const providerB = new ethers.JsonRpcProvider(RPC_B, undefined, { pollingInterval: 1000 });
  return { depA, depB, providerA, providerB };
}
