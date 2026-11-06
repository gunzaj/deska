// Sync health you can see (IMPROVEMENTS S3). sync_state used to hold only
// lastSync and rateLimitedUntil, so a failing cycle left no trace but a 502 in
// the Vercel logs, and the chip could not tell "nothing changed" from "failing
// for six hours".
import type { Kv } from "./poll";

export const MAX_ERROR_LENGTH = 500;

/** Env vars whose values must never reach sync_state, the chip or a log. */
const SECRET_ENV = ["GITHUB_TOKEN", "GITHUB_CLIENT_SECRET", "CRON_SECRET", "AUTH_SECRET", "TOKEN_ENC_KEY"];

/**
 * An error message safe to store and show: configured secrets, GitHub token
 * shapes, bearer/token values and URL credentials are replaced, and the result
 * is cut to 500 characters.
 */
export function redactError(e: unknown, env: Record<string, string | undefined> = process.env): string {
  let msg = e instanceof Error ? e.message : String(e);
  for (const name of SECRET_ENV) {
    const v = env[name]?.trim();
    // Short values (a placeholder like "off") would mangle ordinary words.
    if (v && v.length >= 8) msg = msg.split(v).join("[redacted]");
  }
  msg = msg
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{20,})\b/g, "[redacted]")
    .replace(/\b(bearer|token)(\s+)(?!\[redacted\])[A-Za-z0-9._~+/=-]{16,}/gi, "$1$2[redacted]")
    .replace(/\b(authorization|access_token|token|password)(\s*[:=]\s*["']?)(?!\[redacted\])[^\s"',;&]+/gi, "$1$2[redacted]")
    .replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, "$1[redacted]@");
  return msg.length > MAX_ERROR_LENGTH ? `${msg.slice(0, MAX_ERROR_LENGTH - 1)}…` : msg;
}

export function markAttempt(kv: Kv, nowIso = new Date().toISOString()): void {
  kv.set("sync.lastAttemptAt", nowIso);
}

export function markSuccess(kv: Kv): void {
  kv.set("sync.lastError", "");
  kv.set("sync.consecutiveFailures", "0");
}

export function markFailure(kv: Kv, e: unknown): void {
  kv.set("sync.lastError", redactError(e));
  kv.set("sync.consecutiveFailures", String(consecutiveFailures(kv) + 1));
}

export function consecutiveFailures(kv: Kv): number {
  const n = Number(kv.get("sync.consecutiveFailures") ?? 0);
  return Number.isInteger(n) && n > 0 ? n : 0;
}

/**
 * Run one cycle and record it: `sync.lastAttemptAt` at the start, then success
 * (clears the error, resets the counter) or failure (stores the redacted
 * error, counts it). `failure` reports a cycle that returned but had a failed
 * step (the worker keeps going after one). Logs one JSON line per cycle for
 * log search. A thrown error is rethrown.
 */
export async function recordCycle<T extends object>(
  kv: Kv,
  fn: () => Promise<T>,
  opts: { failure?: (r: T) => string | null; log?: (line: string) => void } = {},
): Promise<T> {
  const log = opts.log ?? ((line: string) => console.log(line));
  const started = Date.now();
  markAttempt(kv, new Date(started).toISOString());
  let result: T;
  try {
    result = await fn();
  } catch (e) {
    markFailure(kv, e);
    log(JSON.stringify({ kind: "sync", ok: false, durationMs: Date.now() - started, error: redactError(e) }));
    throw e;
  }
  const failed = opts.failure?.(result) ?? null;
  if (failed) markFailure(kv, failed);
  else markSuccess(kv);
  log(JSON.stringify({ kind: "sync", ok: !failed, durationMs: Date.now() - started, ...result, error: failed ? redactError(failed) : null }));
  return result;
}

export function healthMaxSyncAgeSec(raw = process.env.HEALTH_MAX_SYNC_AGE_SEC): number {
  const n = Number(raw);
  return raw?.trim() && Number.isFinite(n) && n > 0 ? n : 1800;
}

/** `/api/health`: healthy while the last successful sync is recent enough. */
export function healthOf(kv: Kv, nowMs: number, maxAgeSec: number): { ok: boolean; lastSyncAgeSec: number | null } {
  const last = Date.parse(kv.get("sync.lastSync") ?? "");
  if (!Number.isFinite(last)) return { ok: false, lastSyncAgeSec: null };
  const age = Math.max(0, Math.round((nowMs - last) / 1000));
  return { ok: age <= maxAgeSec, lastSyncAgeSec: age };
}
