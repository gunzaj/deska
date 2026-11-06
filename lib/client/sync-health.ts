// When the sync chip warns (IMPROVEMENTS S3): three failed cycles in a row, or
// no successful sync for 15 minutes.
export const SYNC_STALE_MS = 15 * 60_000;
export const SYNC_FAILURES_WARN = 3;

export type SyncHealth = {
  lastSync: string | null;
  lastAttemptAt: string | null;
  lastError: string | null;
  consecutiveFailures: number;
};

export function syncWarning(s: SyncHealth, nowMs = Date.now()): "failing" | "stale" | null {
  if (s.consecutiveFailures >= SYNC_FAILURES_WARN) return "failing";
  const last = Date.parse(s.lastSync ?? "");
  if (Number.isFinite(last) && nowMs - last > SYNC_STALE_MS) return "stale";
  return null;
}

/** Tooltip for the warning chip: the last error and when the last attempt ran. */
export function syncWarningTitle(s: SyncHealth): string {
  const at = Date.parse(s.lastAttemptAt ?? "");
  const attempt = Number.isFinite(at) ? new Date(at).toLocaleString([], { dateStyle: "short", timeStyle: "short" }) : "never";
  return `${s.lastError ? `Last error: ${s.lastError}` : "No error recorded"} · Last attempt: ${attempt}`;
}
