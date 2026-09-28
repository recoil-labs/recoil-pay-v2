import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// In dev the API runs on :8787 (npm run dev:api); proxy so the page can use
// same-origin paths exactly as it does when the API serves the build.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': 'http://localhost:8787',
      '/og': 'http://localhost:8787',
    },
  },
});
