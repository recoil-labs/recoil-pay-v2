import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const src = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const CSS_TEXT = '\0css-text:';

export default defineConfig({
  plugins: [
    {
      // The build inlines CSS as text for the shadow root (tsup's `text`
      // loader). Vitest stubs CSS files out entirely, so serve them as a
      // virtual JS module instead.
      name: 'css-as-text',
      enforce: 'pre',
      async resolveId(source, importer) {
        if (!source.endsWith('.css')) return null;
        const resolved = await this.resolve(source, importer, { skipSelf: true });
        // Must not end in .css, or Vitest's CSS stub claims it again.
        return resolved ? `${CSS_TEXT}${resolved.id}.js` : null;
      },
      load(id) {
        if (!id.startsWith(CSS_TEXT)) return null;
        return `export default ${JSON.stringify(readFileSync(id.slice(CSS_TEXT.length, -'.js'.length), 'utf8'))};`;
      },
    },
  ],
  resolve: {
    alias: {
      '@recoilpay/intent-core': src('../core/src/index.ts'),
      '@recoilpay/intent-react/styles.css': src('../react/src/styles.css'),
      '@recoilpay/intent-react': src('../react/src/index.ts'),
    },
  },
  test: { environment: 'jsdom', globals: true },
});
