import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono, type MiddlewareHandler } from 'hono';
import { cors } from 'hono/cors';
import { normalizeTag, validateTag } from '../../shared/tag.ts';
import { rateLimit } from './rateLimit.ts';
import { RegistryError, type Registry, type SignedRequest } from './registry.ts';

export interface AppDeps {
  registry: Registry;
  /** Canonical public origin, e.g. https://tags.recoilpay.com. Used in share metadata. */
  publicOrigin: string;
  /** Origins allowed to call the API cross-origin (the static site, when deployed separately). */
  corsOrigins: string[];
  renderOg?: (tag: string | null, reservedAt?: string) => Promise<Buffer>;
  ensName?: (address: string) => Promise<string | null>;
  /** Built web app. When set, this service also serves the page, with per-tag share metadata. */
  webDist?: string;
  /** Per-IP request limits. On unless explicitly disabled (tests). */
  rateLimits?: boolean;
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

export function createApp(deps: AppDeps) {
  const { registry } = deps;
  const app = new Hono();
  const limit = (o: { limit: number; windowMs: number }): MiddlewareHandler =>
    deps.rateLimits === false ? (_c, next) => next() : rateLimit(o);

  app.onError((err, c) => {
    if (err instanceof RegistryError) return c.json({ error: err.code, message: err.message }, err.status);
    console.error(err);
    return c.json({ error: 'internal', message: 'Something went wrong on our side' }, 500);
  });

  if (deps.corsOrigins.length) app.use('/api/*', cors({ origin: deps.corsOrigins, allowMethods: ['GET', 'POST', 'PUT'] }));

  app.get('/api/health', (c) => c.json({ ok: true }));

  app.get('/api/availability/:tag', limit({ limit: 60, windowMs: 10_000 }), async (c) => {
    c.header('Cache-Control', 'no-store');
    return c.json(await registry.availability(c.req.param('tag')));
  });

  const writeLimit = limit({ limit: 12, windowMs: 60_000 });

  const signedBody = async (c: { req: { json: () => Promise<unknown> } }): Promise<SignedRequest> => {
    const b = (await c.req.json().catch(() => null)) as Partial<SignedRequest> | null;
    if (!b || typeof b !== 'object') throw new RegistryError(400, 'bad_request', 'Expected a JSON body');
    return {
      tag: String(b.tag ?? ''),
      address: String(b.address ?? ''),
      chainId: Number(b.chainId),
      issuedAt: String(b.issuedAt ?? ''),
      origin: String(b.origin ?? ''),
      signature: String(b.signature ?? ''),
    };
  };

  app.post('/api/reservations', writeLimit, async (c) => c.json(await registry.reserve(await signedBody(c)), 201));
  app.post('/api/manage', writeLimit, async (c) => c.json(await registry.manage(await signedBody(c))));

  app.put('/api/tags/:tag/routes', writeLimit, async (c) => {
    const token = c.req.header('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
    const body = (await c.req.json().catch(() => null)) as { routes?: Record<string, string>; showAddresses?: boolean } | null;
    if (!body?.routes || typeof body.routes !== 'object') throw new RegistryError(400, 'bad_request', 'Expected routes');
    await registry.setRoutes(c.req.param('tag'), token, { routes: body.routes, showAddresses: Boolean(body.showAddresses) });
    return c.json({ ok: true });
  });

  app.get('/api/tags/:tag', async (c) => {
    const tag = await registry.get(c.req.param('tag'));
    if (!tag) return c.json({ error: 'not_found', message: 'Not reserved' }, 404);
    const ens = deps.ensName ? await deps.ensName(tag.owner) : null;
    c.header('Cache-Control', 'public, max-age=30');
    return c.json({ ...tag, ens });
  });

  app.get('/api/stats', async (c) => {
    c.header('Cache-Control', 'public, max-age=60');
    return c.json({ reserved: await registry.count() });
  });

  // ── Share images ───────────────────────────────────────────────────────
  const ogCache = new Map<string, Buffer>();
  app.get('/og/:file', async (c) => {
    if (!deps.renderOg) return c.notFound();
    const file = c.req.param('file');
    if (!file.endsWith('.png')) return c.notFound();
    const name = normalizeTag(file.slice(0, -4));

    let key = 'default';
    let reservedAt: string | undefined;
    if (name !== 'default') {
      const row = validateTag(name).ok ? await registry.get(name) : null;
      if (!row) return c.notFound();
      key = row.tag;
      reservedAt = row.reservedAt;
    }
    let png = ogCache.get(key);
    if (!png) {
      png = await deps.renderOg(key === 'default' ? null : key, reservedAt);
      if (ogCache.size > 500) ogCache.delete(ogCache.keys().next().value!);
      ogCache.set(key, png);
    }
    c.header('Content-Type', 'image/png');
    c.header('Cache-Control', 'public, max-age=86400, immutable');
    return c.body(new Uint8Array(png));
  });

  // ── The page itself (optional) ─────────────────────────────────────────
  // A static host can't give each /@tag its own og:image, and that card is
  // the thing people see when a tag is posted. Serving the built page from
  // here lets crawlers get per-tag metadata; the static-only deploy still
  // works, just with the generic card.
  if (deps.webDist) {
    const dist = deps.webDist;
    const indexHtml = readFileSync(join(dist, 'index.html'), 'utf8');
    const origin = deps.publicOrigin.replace(/\/$/, '');

    const page = (meta: { title: string; description: string; url: string; image: string }) =>
      indexHtml.replace(
        /<!-- meta:start -->[\s\S]*<!-- meta:end -->/,
        [
          `<title>${escapeHtml(meta.title)}</title>`,
          `<meta name="description" content="${escapeHtml(meta.description)}" />`,
          `<link rel="canonical" href="${escapeHtml(meta.url)}" />`,
          `<meta property="og:type" content="website" />`,
          `<meta property="og:site_name" content="RecoilPay Tags" />`,
          `<meta property="og:title" content="${escapeHtml(meta.title)}" />`,
          `<meta property="og:description" content="${escapeHtml(meta.description)}" />`,
          `<meta property="og:url" content="${escapeHtml(meta.url)}" />`,
          `<meta property="og:image" content="${escapeHtml(meta.image)}" />`,
          `<meta property="og:image:width" content="1200" />`,
          `<meta property="og:image:height" content="630" />`,
          `<meta name="twitter:card" content="summary_large_image" />`,
          `<meta name="twitter:site" content="@RecoilPay" />`,
          `<meta name="twitter:image" content="${escapeHtml(meta.image)}" />`,
        ].join('\n    '),
      );

    const defaultPage = page({
      title: 'RecoilPay Tags — Your wallet, but it has a name',
      description: 'Reserve your RecoilPay tag. Free — a signature, not a transaction.',
      url: `${origin}/`,
      image: `${origin}/og/default.png`,
    });

    app.get('/:handle{@[A-Za-z0-9_]{1,40}}', async (c) => {
      const tag = normalizeTag(c.req.param('handle'));
      const row = validateTag(tag).ok ? await registry.get(tag) : null;
      c.header('Cache-Control', 'public, max-age=60');
      if (!row) return c.html(defaultPage);
      return c.html(
        page({
          title: `@${row.tag} — reserved on RecoilPay`,
          description: `@${row.tag} is reserved on RecoilPay. Reserve your own tag — free, a signature, not a transaction.`,
          url: `${origin}/@${row.tag}`,
          image: `${origin}/og/${row.tag}.png`,
        }),
      );
    });

    app.use('/assets/*', async (c, next) => {
      c.header('Cache-Control', 'public, max-age=31536000, immutable');
      await next();
    });
    app.use('/*', serveStatic({ root: dist }));
    app.get('*', (c) => c.html(defaultPage));
  }

  return app;
}
