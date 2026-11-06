// Sync health you can see (IMPROVEMENTS S3). sync_state used to hold only
// lastSync and rateLimitedUntil, so a failing cycle left no trace but a 502 in
// the server logs, and the chip could not tell "nothing changed" from "failing
// for six hours".
import { redactSecrets } from "../redact";
import type { Kv } from "./poll";

export const MAX_ERROR_LENGTH = 500;

/** Env vars whose values must never reach sync_state, the chip or a log (the CLI scripts read the token from it). */
const SECRET_ENV = ["GITHUB_TOKEN"];

/**
 * An error message safe to store and show: the app's token, configured
 * secrets, GitHub token shapes, bearer/token values and URL credentials are
 * replaced, and the result is cut to 500 characters.
 */
export function redactError(e: unknown, env: Record<string, string | undefined> = process.env): string {
  let msg = redactSecrets(e instanceof Error ? e.message : String(e), SECRET_ENV.map((name) => env[name]?.trim()));
  msg = msg
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
