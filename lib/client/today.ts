// The viewer's day (SPEC §4.3 snoozes, §4.5 sprint timing). The server
// builds one payload per UTC day for every viewer, so its `meta.today` and
// current/next/previous Release are the UTC date's: at 01:30 in UTC+2 the
// server still says yesterday. The browser re-reads both from its own clock
// and zone before anything uses them; the server's cache key stays per UTC day.
import { localToday } from "../tasks/dates";
import type { ClientRelease, WireData } from "./types";

/** The viewer's date, YYYY-MM-DD, in `tz` (default: the browser's zone). */
export const viewerToday = (now = new Date(), tz?: string): string => localToday(now, tz);

/** Current / next / previous Release on `today`: current is the iteration with start ≤ today < end; next and previous by date (as the server resolves them). */
export function releasesOn(releases: readonly ClientRelease[], today: string): { currentReleaseId: string | null; nextReleaseId: string | null; previousReleaseId: string | null } {
  const sorted = [...releases].sort((a, b) => a.startDate.localeCompare(b.startDate));
  const idx = sorted.findIndex((r) => r.startDate <= today && today < r.endDate);
  // Between two iterations, or before the first or after the last: no current
  // one, and next/previous by date (§4.1).
  if (idx < 0) {
    return {
      currentReleaseId: null,
      nextReleaseId: sorted.find((r) => r.startDate > today)?.id ?? null,
      previousReleaseId: [...sorted].reverse().find((r) => r.endDate <= today)?.id ?? null,
    };
  }
  return { currentReleaseId: sorted[idx]!.id, nextReleaseId: sorted[idx + 1]?.id ?? null, previousReleaseId: sorted[idx - 1]?.id ?? null };
}

/** The payload with `today` and the date-resolved Releases on the viewer's day. Same object when nothing changes. */
export function withViewerToday(wire: WireData, today: string): WireData {
  if (wire.meta.today === today) return wire;
  return { ...wire, meta: { ...wire.meta, today, ...releasesOn(wire.meta.releases, today) } };
}
