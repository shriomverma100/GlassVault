import { ethers } from "ethers";

// Non-custodial account wallet. The private key is created in the browser and only ever leaves it
// encrypted with the user's password (standard Web3 Secret Storage / keystore JSON, scrypt). The server
// stores that ciphertext plus a separate password hash — it can never sign for the user.
//
// scrypt N = 2^15 keeps unlock under ~1s in a browser; the server-side password hash is the online
// brute-force barrier, the keystore is the offline one.
const SCRYPT = { N: 2 ** 15, r: 8, p: 1 };

/// New random wallet → { address, keystore } (keystore = encrypted JSON string).
export async function createWallet(password) {
  const wallet = ethers.Wallet.createRandom();
  // encryptKeystoreJson (not wallet.encrypt) is the ethers v6 API that accepts scrypt parameters
  const keystore = await ethers.encryptKeystoreJson({ address: wallet.address, privateKey: wallet.privateKey }, password, { scrypt: SCRYPT });
  return { address: wallet.address, keystore };
}

/// Decrypts a keystore with the password. Throws "Wrong password" on mismatch.
export async function unlockWallet(keystore, password) {
  try {
    return await ethers.Wallet.fromEncryptedJson(keystore, password);
  } catch {
    throw new Error("Wrong password");
  }
}

/// Which workspace each kind of account lands on after signing in.
export const HOME = { Donor: "/passport", NGO: "/ngo", Vendor: "/vendor", Field: "/field", Watcher: "/watchtower" };

export const KIND_INFO = {
  Donor: { title: "Donor", text: "Give to a cause, follow every rupee, vote on disputes, get your money back if proof never comes." },
  NGO: { title: "NGO", text: "Receive purpose-locked donations, pay vendors against signed invoices, prove delivery to beneficiaries." },
  Vendor: { title: "Vendor / payment agent", text: "Sign invoices for goods you delivered and get paid from escrow — or, as a fiat agent, pay local shops in rupees and prove it." },
  Field: { title: "Field partner", text: "Scan beneficiaries' QR cards on delivery — their confirmation releases the final payment." },
  Watcher: { title: "Watcher", text: "Audit any payout in the open, challenge suspicious ones and earn the fraudster's bond." },
};
