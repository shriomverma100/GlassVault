import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Every address comes from the environment (set by scripts/dev.mjs), so an isolated test stack can run
// beside a developer's session. Defaults match `npm start`.
const API = process.env.GV_API || "http://localhost:4000";
const RPC_A = process.env.RPC_A || "http://127.0.0.1:8545";
const RPC_B = process.env.RPC_B || "http://127.0.0.1:8546";
const PORT = Number(process.env.GV_WEB_PORT || 5173);

const rpc = (target) => ({ target, changeOrigin: true, rewrite: () => "/" });
// chains are proxied so the browser never hits CORS; the same table serves dev and the production preview
const proxy = {
  "/api": { target: API, xfwd: true }, // forwards the client IP so login rate limits are per client
  "/ipfs": API,
  "/ws": { target: API.replace(/^http/, "ws"), ws: true },
  "/rpcA": rpc(RPC_A),
  "/rpcB": rpc(RPC_B),
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: PORT, strictPort: true, proxy },
  preview: { port: PORT, strictPort: true, proxy },
  build: {
    rolldownOptions: {
      output: {
        // Long-lived vendor chunks: they change rarely, so the browser keeps them cached across deploys.
        codeSplitting: {
          groups: [
            { name: "react", test: /node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/ },
            { name: "ethers", test: /node_modules[\\/](ethers|@noble|@adraffy)[\\/]/ },
            { name: "motion", test: /node_modules[\\/](framer-motion|motion-dom|motion-utils)[\\/]/ },
          ],
        },
      },
    },
  },
});
