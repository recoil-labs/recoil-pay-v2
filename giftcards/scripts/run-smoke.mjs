/* Runs scripts/smoke.mjs against a local aggregator.
 *
 * Bundles first because the test imports @noble from this package, and node
 * cannot resolve those from a bare script. Start the aggregator with:
 *
 *   cd ../linkiswap-core/aggregator
 *   INTEGRITY_SECRET=local FILL_WALLET_ENCRYPTION_KEY="$(openssl rand -base64 32)" cargo run
 *
 * then `npm run smoke`.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'recoil-smoke-'));
try {
  const bundle = join(dir, 'smoke.mjs');
  execFileSync(
    'npx',
    ['esbuild', 'scripts/smoke.mjs', '--bundle', '--format=esm', '--platform=node',
     `--outfile=${bundle}`, '--log-level=error'],
    { stdio: 'inherit' },
  );
  execFileSync('node', [bundle], { stdio: 'inherit' });
} catch {
  process.exitCode = 1;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
