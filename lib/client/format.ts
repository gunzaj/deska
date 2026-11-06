const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** "3m", "5h", "4d", "Mar 3", "Mar 3, 2025" — compact, Linear-style. */
export function shortAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";
  const d = now - t;
  if (d < MIN) return "now";
  if (d < HOUR) return `${Math.floor(d / MIN)}m`;
  if (d < DAY) return `${Math.floor(d / HOUR)}h`;
  if (d < 30 * DAY) return `${Math.floor(d / DAY)}d`;
  return formatDate(iso, now);
}

export function longAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "never";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "never";
  const d = now - t;
  if (d < MIN) return "just now";
  if (d < HOUR) return `${Math.floor(d / MIN)} min ago`;
  if (d < DAY) return `${Math.floor(d / HOUR)} h ago`;
  const days = Math.floor(d / DAY);
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  return formatDate(iso, now);
}

export function formatDate(iso: string, now = Date.now()): string {
  const d = new Date(iso);
  // A bare YYYY-MM-DD (release dates) parses as UTC midnight; formatting it in
  // local time would show the previous day west of UTC.
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(iso);
  const year = (x: Date) => (dateOnly ? x.getUTCFullYear() : x.getFullYear());
  const sameYear = year(d) === year(new Date(now));
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }), ...(dateOnly ? { timeZone: "UTC" } : {}) });
}

/** Last day of a range whose end is exclusive (release `endDate`), as YYYY-MM-DD. */
export function lastDay(endExclusive: string): string {
  const d = new Date(`${endExclusive}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(aIso: string, bIso: string): number {
  return Math.round((Date.parse(bIso) - Date.parse(aIso)) / DAY);
}

/** Option names carry emoji ("📋 To do"); strip them for compact text and search. */
export function plainName(name: string): string {
  return name
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function pluralize(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}
