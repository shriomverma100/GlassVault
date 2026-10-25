require("@nomicfoundation/hardhat-toolbox");

// Two local chains: A = main donation chain, B = bridged chain (multi-chain tracking).
module.exports = {
  solidity: {
    version: "0.8.28",
    settings: { optimizer: { enabled: true, runs: 200 }, viaIR: true, evmVersion: "cancun" },
  },
  networks: {
    // `npm run chain:b` starts a second node with CHAIN_ID=31338 on port 8546.
    hardhat: { chainId: Number(process.env.CHAIN_ID || 31337) },
    chainA: { url: "http://127.0.0.1:8545", chainId: 31337 },
    chainB: { url: "http://127.0.0.1:8546", chainId: 31338 },
  },
};
