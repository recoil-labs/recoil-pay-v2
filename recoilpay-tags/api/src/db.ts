import { readFileSync } from 'node:fs';
import pg from 'pg';

export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export interface Db extends Queryable {
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

const SCHEMA = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');

/** Production: a pg pool against DATABASE_URL. */
export function createPgDb(connectionString: string): Db {
  const pool = new pg.Pool({
    connectionString,
    max: 10,
    // Railway's internal Postgres URL is plain; its public proxy needs TLS.
    ssl: /sslmode=require|proxy\.rlwy\.net/.test(connectionString) ? { rejectUnauthorized: false } : undefined,
  });
  return {
    query: (sql, params) => pool.query(sql, params) as never,
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const out = await fn({ query: (sql, params) => client.query(sql, params) as never });
        await client.query('COMMIT');
        return out;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

/**
 * Local dev and tests: PGlite, which is real Postgres compiled to WASM, so
 * the unique index, CHECK constraints and advisory locks behave as in prod.
 * Imported lazily because it is a dev dependency.
 */
export async function createPgliteDb(dataDir?: string): Promise<Db> {
  const { PGlite } = await import('@electric-sql/pglite');
  const lite = new PGlite(dataDir);
  return {
    query: (sql, params) => lite.query(sql, params) as never,
    tx: (fn) => lite.transaction((t) => fn({ query: (sql, params) => t.query(sql, params) as never })),
    close: () => lite.close(),
  };
}

export async function migrate(db: Db): Promise<void> {
  // Split on statement ends: pg accepts a multi-statement string, PGlite's
  // parameterised query() does not, and exec() isn't on the shared interface.
  for (const stmt of SCHEMA.split(/;\s*$/m).map((s) => s.trim()).filter(Boolean)) {
    await db.query(stmt);
  }
}
