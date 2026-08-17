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
        target: "http://127.0.0.1:4000",
        changeOrigin: true,
      },
      "/solver-api": {
        target: "http://127.0.0.1:4000",
        changeOrigin: true,
      },
      "/quotes": {
        target: "http://127.0.0.1:4000",
        changeOrigin: true,
      },
      "/ws": {
        target: "ws://127.0.0.1:4000",
        ws: true,
        changeOrigin: true,
      },
    },
  },
});
