const fs = require("node:fs");
const path = require("node:path");
const { ethers, network, artifacts } = require("hardhat");

// Chain A (31337) = home chain: DINR + GlassVault + destination BridgeGateway.
// Chain B (31338) = remote chain: DINR + source BridgeGateway.
// The deployer (hardhat account #0) is the demo relayer on both.
const CHALLENGE_WINDOW = Number(process.env.CHALLENGE_WINDOW || 45); // seconds — short for live demos
const BRIDGE_LIQUIDITY = ethers.parseUnits("10000000", 18);

const abiOf = async (name) => (await artifacts.readArtifact(name)).abi;

async function main() {
  const [deployer] = await ethers.getSigners();
  const { chainId } = await ethers.provider.getNetwork();
  const isHome = Number(chainId) === 31337;

  const dinr = await ethers.deployContract("DINR");
  const gateway = await ethers.deployContract("BridgeGateway", [await dinr.getAddress(), deployer.address]);
  const out = {
    chainId: Number(chainId),
    network: network.name,
    DINR: { address: await dinr.getAddress(), abi: await abiOf("DINR") },
    BridgeGateway: { address: await gateway.getAddress(), abi: await abiOf("BridgeGateway") },
  };

  if (isHome) {
    const vault = await ethers.deployContract("GlassVault", [await dinr.getAddress(), CHALLENGE_WINDOW, await gateway.getAddress()]);
    await (await dinr.mint(await gateway.getAddress(), BRIDGE_LIQUIDITY)).wait();
    await (await gateway.setVault(await vault.getAddress())).wait();
    out.challengeWindow = CHALLENGE_WINDOW;
    out.GlassVault = { address: await vault.getAddress(), abi: await abiOf("GlassVault") };
    out.ProofOfImpact = { address: await vault.impactToken(), abi: await abiOf("ProofOfImpact") };
  }

  // Shared with backend + frontend.
  const file = path.join(__dirname, "..", "..", "shared", `deployment.${network.name}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  for (const [k, v] of Object.entries(out)) if (v?.address) console.log(`${k.padEnd(14)} ${v.address}`);
  console.log(`→ ${path.relative(process.cwd(), file)}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
