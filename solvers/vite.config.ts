import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
//
// The dev server proxies `/api`, `/solver-api`, `/quotes`, and `/ws` to a
// local aggregator running on port 4000 — but ONLY when no
// `VITE_API_BASE_URL` is set. When the dashboard is pointed at a deployed
// aggregator (e.g. via `.env.local`), relative paths still hit the dev
// server first; we let the `axios` client take them straight to the
// remote URL instead.
const envApiBase = process.env.VITE_API_BASE_URL || ''
const proxyLocalAggregator = !envApiBase

const localAggregatorHttp = {
  target: 'http://127.0.0.1:4000',
  changeOrigin: true,
  secure: false,
}

const localAggregatorWs = {
  ...localAggregatorHttp,
  target: 'ws://127.0.0.1:4000',
  ws: true,
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5174,
    proxy: proxyLocalAggregator
      ? {
          '/api': localAggregatorHttp,
          '/solver-api': localAggregatorHttp,
          '/quotes': localAggregatorHttp,
          '/ws': localAggregatorWs,
        }
      : undefined,
  },
})