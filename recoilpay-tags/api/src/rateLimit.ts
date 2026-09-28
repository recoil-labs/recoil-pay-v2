import type { MiddlewareHandler } from 'hono';

/**
 * Fixed-window, in-memory, per client IP. Enough for a single API instance;
 * move it to Postgres or Redis before running more than one replica.
 */
export function rateLimit(opts: { limit: number; windowMs: number }): MiddlewareHandler {
  const hits = new Map<string, { n: number; reset: number }>();
  return async (c, next) => {
    // Railway terminates TLS at its proxy, which appends the client IP.
    const ip = c.req.header('x-forwarded-for')?.split(',')[0].trim() || c.req.header('x-real-ip') || 'local';
    const now = Date.now();
    if (hits.size > 50_000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
    let entry = hits.get(ip);
    if (!entry || entry.reset < now) {
      entry = { n: 0, reset: now + opts.windowMs };
      hits.set(ip, entry);
    }
    if (++entry.n > opts.limit) {
      c.header('Retry-After', String(Math.ceil((entry.reset - now) / 1000)));
      return c.json({ error: 'rate_limited', message: 'Too many requests — slow down a little' }, 429);
    }
    await next();
  };
}
