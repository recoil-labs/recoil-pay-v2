import { existsSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { serve } from '@hono/node-server';
import { createApp } from './app.ts';
import { ensName, verifySignature } from './chain.ts';
import { createPgDb, createPgliteDb, migrate } from './db.ts';
import { renderOg } from './og.ts';
import { createRegistry } from './registry.ts';

const publicOrigin = process.env.PUBLIC_ORIGIN ?? 'http://localhost:5173';
const list = (v?: string) => (v ?? '').split(',').map((s) => s.trim()).filter(Boolean);

// Without DATABASE_URL we fall back to an on-disk PGlite so `npm run dev`
// needs no Postgres. Production must set DATABASE_URL.
if (!process.env.DATABASE_URL && process.env.NODE_ENV === 'production') {
  throw new Error('DATABASE_URL is required in production');
}
const db = process.env.DATABASE_URL ? createPgDb(process.env.DATABASE_URL) : await createPgliteDb('.pglite');
await migrate(db);

// serveStatic resolves its root against the working directory.
const distPath = resolve(process.env.WEB_DIST ?? '../web/dist');
const webDist = existsSync(resolve(distPath, 'index.html')) ? relative(process.cwd(), distPath) || '.' : undefined;

const app = createApp({
  registry: createRegistry(db, verifySignature, {
    // Messages are signed for the page's origin; accept the public one and
    // any extra (preview deploys, localhost) listed in ALLOWED_ORIGINS.
    allowedOrigins: [publicOrigin, ...list(process.env.ALLOWED_ORIGINS)],
  }),
  publicOrigin,
  corsOrigins: list(process.env.CORS_ORIGINS),
  renderOg,
  ensName,
  webDist,
});

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, () => {
  console.log(`tags api on :${port}${webDist ? ` (serving ${webDist})` : ''}`);
});
