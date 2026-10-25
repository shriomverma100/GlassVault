import { ethers } from "ethers";

/// Bridge relayer: watches DonationSent on chain B and delivers each one into a tagged vault lot on
/// chain A. Replays are rejected on-chain ((sourceChain, nonce) can be delivered once), so restarting
/// the relayer is always safe.
export class Relayer {
  constructor({ indexer, depA, depB, providerA, key, broadcast }) {
    this.indexer = indexer;
    this.depB = depB;
    this.wallet = new ethers.Wallet(key, providerA);
    this.gatewayA = new ethers.Contract(depA.BridgeGateway.address, depA.BridgeGateway.abi, this.wallet);
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
    const tx = await this.gatewayA.deliverDonation(ev.chainId, a.nonce, a.donor, a.ngoId, a.category, a.amount, a.deadline);
    await tx.wait();
    this.broadcast("relayer", { status: "delivered", nonce: a.nonce, sourceTx: ev.tx, destTx: tx.hash });
  }
}
