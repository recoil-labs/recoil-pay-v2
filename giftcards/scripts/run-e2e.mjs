/* Bundles and runs the end-to-end trade. See scripts/e2e-trade.mjs.
 *
 *   export MERCHANT_KEY=0x...   # two different wallets
 *   export USER_KEY=0x...
 *   npm run e2e
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'recoil-e2e-'));
try {
  const bundle = join(dir, 'e2e.mjs');
  execFileSync('npx', ['esbuild', 'scripts/e2e-trade.mjs', '--bundle', '--format=esm',
    '--platform=node', `--outfile=${bundle}`, '--log-level=error'], { stdio: 'inherit' });
  execFileSync('node', [bundle], { stdio: 'inherit' });
} catch {
  process.exitCode = 1;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
