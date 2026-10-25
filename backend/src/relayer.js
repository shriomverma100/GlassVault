import { ethers } from "ethers";

/// Bridge relayer: watches DonationSent on chain B and delivers each one into a tagged vault lot on
/// chain A. Replays are rejected on-chain ((sourceChain, nonce) can be delivered once), so restarting
/// the relayer is always safe.
export class Relayer {
  constructor({ indexer, depA, depB, providerA, providerB, key, broadcast }) {
    this.indexer = indexer;
    this.depB = depB;
    this.wallet = new ethers.Wallet(key, providerA);
    this.gatewayA = new ethers.Contract(depA.BridgeGateway.address, depA.BridgeGateway.abi, this.wallet);
    // same relayer key on the source chain: it can refund what the destination refuses
    this.gatewayB = providerB ? new ethers.Contract(depB.BridgeGateway.address, depB.BridgeGateway.abi, new ethers.Wallet(key, providerB)) : null;
    this.broadcast = broadcast;
    this.queue = Promise.resolve();
  }

  start() {
    const handle = (ev) => {
      if (ev.name !== "DonationSent" || ev.chainId !== this.depB.chainId) return;
      this.queue = this.queue.then(() => this.deliver(ev)).catch((e) => {
        console.error("[relayer]", e.shortMessage || e.message);
        this.broadcast("relayer", { status: "failed", nonce: ev.args.nonce, error: e.shortMessage || e.message });
      });
    };
    // catch up on anything sent while we were offline, then follow live
    this.indexer.events.forEach(handle);
    this.indexer.on("event", handle);
  }

  async deliver(ev) {
    const a = ev.args;
    const key = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["uint64", "uint256"], [ev.chainId, a.nonce]));
    if (await this.gatewayA.delivered(key)) return;
    const args = [ev.chainId, a.nonce, a.donor, a.ngoId, a.category, a.amount, a.deadline];
    try {
      await this.gatewayA.deliverDonation.staticCall(...args);
    } catch (e) {
      // the destination contract refuses it (NGO frozen, deadline too close…) — retrying can't help, so
      // the donor gets the locked dINR back on the source chain instead of it being stuck in the bridge
      if (e.code !== "CALL_EXCEPTION" || !this.gatewayB) throw e;
      const sent = await this.gatewayB.sent(a.nonce);
      if (sent.refunded) return;
      const r = await this.gatewayB.refundFailed(a.nonce);
      await r.wait();
      this.broadcast("relayer", { status: "refunded", nonce: a.nonce, reason: e.revert?.name ?? e.shortMessage, refundTx: r.hash });
      return;
    }
    const tx = await this.gatewayA.deliverDonation(...args);
    await tx.wait();
    this.broadcast("relayer", { status: "delivered", nonce: a.nonce, sourceTx: ev.tx, destTx: tx.hash });
  }
}
