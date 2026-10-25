// Logins for the seeded local-chain history — one per role, fictional people and organisations.
// LOCAL-CHAIN SEED DATA ONLY: the wallets are Hardhat dev keys (public) and these passwords are
// published in the repo — never reuse either on a real network.
//
// [username, dev role key, account kind, display name, password, what this account shows]
export const DEMO_ACCOUNTS = [
  ["priya", "donorPriya", "Donor", "Priya Nair", "Priya@Donor26", "Individual donor — Water + Medical gifts, one bridged from chain B"],
  ["rahul", "donorRahul", "Donor", "Rahul Mehta", "Rahul@Donor26", "Donor whose 0.25 ETH was swapped, bridged and spent via a fiat agent"],
  ["navkiran", "donorCSR", "Donor", "Navkiran CSR Fund", "Navkiran@CSR26", "Company CSR fund — its gift to Shadow Trust has Asha as fallback"],
  ["asha", "ngoAsha", "NGO", "Asha Foundation", "Asha@NGO2026", "Honest NGO — completed payouts, a signed invoice waiting in its inbox"],
  ["shadow", "ngoShadow", "NGO", "Shadow Trust", "Shadow@NGO2026", "The adversarial NGO used by the red-team attack"],
  ["bluewell", "vendorWater", "Vendor", "BlueWell Pumps", "BlueWell@Vendor26", "Water supplier — signs invoices for hand pumps"],
  ["medicare", "vendorMedical", "Vendor", "Medilink Supplies", "Medilink@Vendor26", "Medical supplier — its invoice MC-311 waits for Asha"],
  ["vidya", "vendorEducation", "Vendor", "Vidya Books", "Vidya@Vendor26", "Education supplier"],
  ["quickfix", "vendorShell", "Vendor", "QuickFix Traders", "QuickFix@Vendor26", "Shell vendor the red team registers"],
  ["paylink", "offrampAgent", "Vendor", "PayLink Fiat Agents", "PayLink@Agent26", "Fiat payment agent — pays village shops in rupees and proves it"],
  ["field", "fieldWorker", "Field", "Sahyog Field Partners", "Sahyog@Field26", "Independent field partner — issues QR cards, confirms handovers"],
  ["watcher", "watcher", "Watcher", "OpenLedger Watch", "Watch@Tower26", "Watcher — challenges, red team, reconciler, benchmark"],
];

export const DEMO_PASSWORD = Object.fromEntries(DEMO_ACCOUNTS.map(([u, , , , pw]) => [u, pw]));
