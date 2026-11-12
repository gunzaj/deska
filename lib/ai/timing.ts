// How an AI action's elapsed time is shown (item 6). Pure, so the running
// labels and their tests agree on the format.
export function formatDuration(ms: number): string {
  const s = Math.max(0, ms) / 1000;
  if (s < 10) return `${s.toFixed(1)} s`;
  if (s < 60) return `${Math.round(s)} s`;
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  return `${m} min ${String(r).padStart(2, "0")} s`;
}

/** Milliseconds from an ISO time to `now`, or null when the time is unreadable. */
export function elapsedSince(since: string, now: number = Date.now()): number | null {
  const at = Date.parse(since);
  return Number.isFinite(at) ? Math.max(0, now - at) : null;
}
