import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": new URL("./src", import.meta.url).pathname,
    },
  },
  server: {
    watch: {
      ignored: ["**/website/**"],
    },
    proxy: {
      "/api": {
        target: "https://recoil-aggregator-675174162902.us-central1.run.app",
        changeOrigin: true,
      },
      "/solver-api": {
        target: "https://recoil-aggregator-675174162902.us-central1.run.app",
        changeOrigin: true,
      },
      "/quotes": {
        target: "https://recoil-aggregator-675174162902.us-central1.run.app",
        changeOrigin: true,
      },
      "/ws": {
        target: "wss://recoil-aggregator-675174162902.us-central1.run.app",
        ws: true,
        changeOrigin: true,
      },
    },
  },
});
