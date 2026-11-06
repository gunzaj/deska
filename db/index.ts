import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

let pool: Pool | undefined;
let client: NodePgDatabase<typeof schema> | undefined;

/**
 * Lazily created Drizzle client. Callers must check `databaseUrl()` first: the
 * previous version opened a Pool against a hardcoded localhost URL at import
 * time, so any module graph that reached this file tried to connect even in
 * environments with no database at all.
 */
export function databaseUrl(): string | null {
  const url = process.env.DATABASE_URL;
  return url && url.trim() ? url.trim() : null;
}

/**
 * Pool settings (S10). The pg defaults (10 connections, no idle timeout) times
 * many serverless instances exhausted Neon's connection limit. Each instance
 * now keeps at most DB_POOL_MAX (5) connections, drops idle ones after 10 s,
 * and fails a connect after 5 s instead of hanging the request.
 */
export function poolConfig(env: Record<string, string | undefined> = process.env): { max: number; idleTimeoutMillis: number; connectionTimeoutMillis: number } {
  const n = Number(env.DB_POOL_MAX);
  return {
    max: env.DB_POOL_MAX?.trim() && Number.isInteger(n) && n > 0 ? n : 5,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
  };
}

export function getDb(): NodePgDatabase<typeof schema> {
  getPool();
  return client!;
}

/** The shared pool, for code that needs one dedicated client (the sync lock). */
export function getPool(): Pool {
  const url = databaseUrl();
  if (!url) throw new Error("DATABASE_URL is not configured");
  // Pool and client are created and torn down together, so checking one is
  // enough: the old `!pool || !client` could build a second Pool over the
  // first without ending it, leaking its connections.
  if (!pool) {
    const created = new Pool({ connectionString: url, ...poolConfig() });
    // pg emits 'error' on the pool when an idle connection drops (a Postgres
    // restart, or a managed host such as Neon closing idle sockets). With no
    // listener Node treats it as an uncaught exception and the long-running
    // worker exits; the pool replaces the connection on the next query.
    created.on("error", (e) => console.error(`postgres pool: idle client error: ${e.message}`));
    pool = created;
    client = drizzle(created, { schema });
  }
  return pool;
}

export async function closeDb(): Promise<void> {
  await pool?.end();
  pool = undefined;
  client = undefined;
}