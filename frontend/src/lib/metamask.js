// MetaMask (any EIP-1193 wallet) — discovery, connect, chain switching and Sign-In with Ethereum.

let discovered = null;

/// EIP-6963: wallets announce themselves on request, so several installed extensions don't fight over
/// window.ethereum. Prefer MetaMask; fall back to the legacy injected provider.
export function discoverWallet() {
  if (discovered) return Promise.resolve(discovered);
  return new Promise((resolve) => {
    const found = [];
    const onAnnounce = (e) => found.push(e.detail);
    window.addEventListener("eip6963:announceProvider", onAnnounce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    // announcements are synchronous in practice; give slow extensions a moment
    setTimeout(() => {
      window.removeEventListener("eip6963:announceProvider", onAnnounce);
      const mm = found.find((d) => d.info?.rdns === "io.metamask") ?? found[0];
      discovered = mm ? { provider: mm.provider, name: mm.info?.name ?? "Wallet" } : window.ethereum ? { provider: window.ethereum, name: "MetaMask" } : null;
      resolve(discovered);
    }, 150);
  });
}

export async function requireWallet() {
  const w = await discoverWallet();
  if (!w) throw new Error("MetaMask not found — install it to continue");
  return w.provider;
}

/// Asks the wallet for account access; returns the selected address (checksummed by the caller).
export async function connect() {
  const provider = await requireWallet();
  const [address] = await provider.request({ method: "eth_requestAccounts" });
  if (!address) throw new Error("No account selected in MetaMask");
  return address;
}

export const selectedAccount = async (provider) => (await provider.request({ method: "eth_accounts" }))[0] ?? null;

/// Switches MetaMask to the chain; adds it first if MetaMask doesn't know it (local Hardhat chains).
export async function ensureChain(provider, { chainId, name, rpcUrl }) {
  const hex = `0x${Number(chainId).toString(16)}`;
  if ((await provider.request({ method: "eth_chainId" })) === hex) return;
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] });
  } catch (e) {
    const code = e?.code ?? e?.data?.originalError?.code;
    if (code !== 4902) throw e;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [{ chainId: hex, chainName: name, rpcUrls: [rpcUrl], nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 } }],
    });
  }
}

/// The two GlassVault chains as MetaMask sees them (RPC URLs come from the backend config). Opened
/// through a public link, 127.0.0.1 would be the visitor's own machine, so MetaMask gets this site's
/// /rpcA and /rpcB proxies instead.
const remote = typeof location !== "undefined" && !["localhost", "127.0.0.1"].includes(location.hostname);
export const chainSpecs = (config) => ({
  A: { chainId: config.chainA.chainId, name: "GlassVault Chain A (local)", rpcUrl: remote ? `${location.origin}/rpcA` : (config.walletRpcA ?? config.rpcA) },
  B: { chainId: config.chainB.chainId, name: "GlassVault Chain B (local)", rpcUrl: remote ? `${location.origin}/rpcB` : (config.walletRpcB ?? config.rpcB) },
});

/// Standard EIP-4361 message — MetaMask shows it as a sign-in request for this site.
export function siweMessage({ domain, address, uri, chainId, nonce }) {
  return [
    `${domain} wants you to sign in with your Ethereum account:`,
    address,
    "",
    "Sign in to GlassVault.",
    "",
    `URI: ${uri}`,
    "Version: 1",
    `Chain ID: ${chainId}`,
    `Nonce: ${nonce}`,
    `Issued At: ${new Date().toISOString()}`,
  ].join("\n");
}
