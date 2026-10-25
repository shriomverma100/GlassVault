import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const rpc = (target) => ({ target, changeOrigin: true, rewrite: () => "/" });

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:4000",
      "/ipfs": "http://localhost:4000",
      "/ws": { target: "ws://localhost:4000", ws: true },
      // chains are proxied so the browser never hits CORS
      "/rpcA": rpc("http://127.0.0.1:8545"),
      "/rpcB": rpc("http://127.0.0.1:8546"),
    },
  },
});
