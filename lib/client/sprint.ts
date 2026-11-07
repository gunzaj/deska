// Sprint view (§4.5): what is Remaining, Done and Not planned in one iteration
// of the mapped Sprint field, and the numbers the header shows. Pure, so the
// header, the list groups and the tests all count the same way.
import { daysBetween } from "./format";
import { fieldLabel, valueLabel, type FilterFieldKey } from "./explorer";
import type { ClientIssue, ClientMeta, ClientRelease } from "./types";
import type { Filter } from "../views/view";

export { BUCKET_LABEL, BUCKET_ORDER, sprintBucket, type SprintBucket } from "./sprint-bucket";
import { sprintBucket, type SprintBucket } from "./sprint-bucket";

export type SprintStats = {
  remaining: number;
  done: number;
  notPlanned: number;
  /** Remaining + Done: what the percentage is out of (not planned is excluded). */
  counted: number;
  /** Whole percent of `counted` that is done; null when nothing is counted (never 0% or 100% of nothing). */
  pct: number | null;
  /** Open issues per Status option, in project order, then those without a Status. */
  byStatus: { id: string | null; n: number }[];
};

export function sprintStats(issues: ClientIssue[], meta: Pick<ClientMeta, "fields" | "mapping">): SprintStats {
  const doneIds = new Set(meta.mapping.doneStatusIds);
  const n: Record<SprintBucket, number> = { remaining: 0, done: 0, notPlanned: 0 };
  const open = new Map<string | null, number>();
  for (const i of issues) {
    n[sprintBucket(i, doneIds)] += 1;
    if (i.state === "open") open.set(i.statusId, (open.get(i.statusId) ?? 0) + 1);
  }
  const counted = n.remaining + n.done;
  const byStatus = [
    ...meta.fields.status.filter((o) => open.has(o.id)).map((o) => ({ id: o.id as string | null, n: open.get(o.id)! })),
    ...(open.has(null) ? [{ id: null, n: open.get(null)! }] : []),
  ];
  return { ...n, counted, pct: counted ? Math.round((n.done / counted) * 100) : null, byStatus };
}

export type SprintTiming = {
  phase: "current" | "upcoming" | "past";
  /** Days from today to the exclusive end date, for the current sprint; else null. */
  daysLeft: number | null;
  /** Days until it starts, for an upcoming sprint; else null. */
  startsIn: number | null;
};

/** By date: current = `start ≤ today < end`. */
export function sprintTiming(r: Pick<ClientRelease, "startDate" | "endDate">, today: string): SprintTiming {
  if (today < r.startDate) return { phase: "upcoming", daysLeft: null, startsIn: daysBetween(today, r.startDate) };
  if (today >= r.endDate) return { phase: "past", daysLeft: null, startsIn: null };
  return { phase: "current", daysLeft: daysBetween(today, r.endDate), startsIn: null };
}

/** The sprint before/after `id` in date order (the picker's `[` and `]`); null at either end. */
export function neighbour(releases: Pick<ClientRelease, "id">[], id: string, dir: -1 | 1): string | null {
  const at = releases.findIndex((r) => r.id === id);
  if (at < 0) return null;
  return releases[at + dir]?.id ?? null;
}

/**
 * "Platform team · Alice" for the header when the list is filtered: the values
 * of every active filter other than the free-text search, which reads as its
 * quoted words. Empty when there is nothing to say.
 */
export function filterSummary(filters: Filter[], meta: ClientMeta, issues: ClientIssue[]): string {
  const parts: string[] = [];
  for (const f of filters) {
    if (f.field === "text") {
      if (f.value) parts.push(`“${f.value}”`);
    } else if (f.field === "any") parts.push("Any of several filters");
    else if ("values" in f && f.values?.length) {
      const names = f.values.map((v) => valueLabel(f.field as FilterFieldKey, v, meta, issues).replace(/\s+/g, " "));
      parts.push(f.op === "not_in" ? `Not ${names.join(", ")}` : names.join(", "));
    } else if (f.op === "empty") parts.push(`No ${fieldLabel(f.field, meta).toLowerCase()}`);
    else if ("days" in f) parts.push(`${f.field} ${f.op === "within_days" ? "within" : "older than"} ${f.days} days`);
    else if (f.field === "parent") parts.push("Has sub-issues");
  }
  return parts.join(" · ");
}
