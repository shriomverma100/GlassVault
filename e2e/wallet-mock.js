// An EIP-1193 wallet announced over EIP-6963 as "io.metamask" — the interface the MetaMask extension
// exposes — whose key lives in the test process. The app's own MetaMask code runs unchanged.
import { createRequire } from "node:module";

const { ethers } = createRequire(new URL("../backend/package.json", import.meta.url))("ethers");

export async function installMetaMask(ctx, key = ethers.Wallet.createRandom().privateKey) {
  const networks = new Map();
  let current = null;
  const log = [];
  const signer = new ethers.Wallet(key);
  async function handle(method, params) {
    switch (method) {
      case "eth_requestAccounts":
      case "eth_accounts":
        return [signer.address];
      case "eth_chainId":
        return current ?? "0x1";
      case "net_version":
        return String(parseInt(current ?? "0x1", 16));
      case "wallet_switchEthereumChain":
        if (!networks.has(params[0].chainId)) return { __error: { code: 4902, message: "Unrecognized chain" } };
        log.push(`switch ${parseInt(params[0].chainId, 16)}`);
        current = params[0].chainId;
        return null;
      case "wallet_addEthereumChain":
        networks.set(params[0].chainId, new ethers.JsonRpcProvider(params[0].rpcUrls[0], undefined, { staticNetwork: true, cacheTimeout: -1 }));
        log.push(`add ${parseInt(params[0].chainId, 16)}`);
        current = params[0].chainId;
        return null;
      case "personal_sign":
        log.push("personal_sign");
        return signer.signMessage(ethers.getBytes(params[0]));
      case "eth_signTypedData_v4": {
        const { domain, types, message } = JSON.parse(params[1]);
        delete types.EIP712Domain;
        log.push("signTypedData");
        return signer.signTypedData(domain, types, message);
      }
      case "eth_sendTransaction": {
        const t = params[0];
        const tx = await signer.connect(networks.get(current)).sendTransaction({ to: t.to, data: t.data, value: t.value ?? 0, gasLimit: t.gas ?? undefined });
        log.push(`send ${parseInt(current, 16)}`);
        return tx.hash;
      }
      default:
        if (!current) return { __error: { code: 4100, message: `no network for ${method}` } };
        return networks.get(current).send(method, params);
    }
  }
  await ctx.exposeFunction("__walletRequest", async (method, params) => {
    try {
      return await handle(method, params ?? []);
    } catch (e) {
      return { __error: { code: e.code ?? -32603, message: e.shortMessage ?? e.message } };
    }
  });
  await ctx.addInitScript(() => {
    const provider = {
      isMetaMask: true,
      async request({ method, params }) {
        const out = await window.__walletRequest(method, params);
        if (out && out.__error) throw Object.assign(new Error(out.__error.message), { code: out.__error.code });
        return out;
      },
      on: () => provider,
      removeListener: () => provider,
    };
    window.addEventListener("eip6963:requestProvider", () =>
      window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info: { uuid: "demo-metamask", name: "MetaMask", icon: "data:,", rdns: "io.metamask" }, provider }) })),
    );
    window.ethereum = provider;
  });
  return { address: signer.address, log };
}
