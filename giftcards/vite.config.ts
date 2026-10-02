import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Same proxy arrangement as the solver dashboard: relative paths go to a
// local aggregator on :4000 during development, but only when no
// VITE_API_BASE_URL is set. Once the app is pointed at a deployed
// aggregator the API client sends absolute URLs and the proxy is bypassed.
const proxyLocalAggregator = !process.env.VITE_API_BASE_URL

const localAggregator = {
  target: 'http://127.0.0.1:4000',
  changeOrigin: true,
  secure: false,
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // 5174 is the solver dashboard; both run side by side in development.
    port: 5175,
    proxy: proxyLocalAggregator
      ? { '/api': localAggregator, '/solver-api': localAggregator }
      : undefined,
  },
})
