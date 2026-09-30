import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Test against the core's source, not its last build.
  resolve: { alias: { '@recoilpay/intent-core': fileURLToPath(new URL('../core/src/index.ts', import.meta.url)) } },
  test: { environment: 'jsdom', globals: true },
});
