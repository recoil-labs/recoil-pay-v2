import { fileURLToPath } from 'node:url';
import { defineConfig } from 'tsup';

const src = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/**
 * Browser bundle for `<script type="module" src=".../recoilpay-intent-widget.js">`.
 * Everything is bundled (the host page provides nothing), and code-split so
 * the WalletConnect chunk only downloads when someone chooses WalletConnect.
 * Chunks load relative to the entry file, so serve the whole dist/ folder.
 */
export default defineConfig({
  entry: { 'recoilpay-intent-widget': 'src/index.ts' },
  format: ['esm'],
  platform: 'browser',
  target: 'es2020',
  splitting: true,
  minify: true,
  clean: true,
  // No sourcemaps: they're ~70% of the published package, almost all of it
  // for bundled third-party code (WalletConnect), and CDN users never load them.
  sourcemap: false,
  noExternal: [/.*/],
  loader: { '.css': 'text' },
  define: { 'process.env.NODE_ENV': '"production"', global: 'globalThis' },
  esbuildOptions(options) {
    options.alias = {
      '@recoilpay/intent-core': src('../core/src/index.ts'),
      '@recoilpay/intent-react/styles.css': src('../react/src/styles.css'),
      '@recoilpay/intent-react': src('../react/src/index.ts'),
    };
    options.chunkNames = 'chunks/[name]-[hash]';
  },
});
