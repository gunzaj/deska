// The labels and assignees the user adds most often, for the top of the
// pickers (SPEC §4.8). Read from the local audit log, so nothing extra is
// stored: an add is a finished labels/assignees edit or a created issue.
import { and, eq, gte, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { auditLog } from "@/db/schema";

/** Only adds this recent count, so a habit from an old project drops out. */
export const FREQUENT_DAYS = 90;
/** Fewer adds than this never promote a choice. */
export const FREQUENT_MIN_USES = 3;
/** How many choices are promoted per field. */
export const FREQUENT_MAX = 3;
/**
 * Adds of one value closer together than this are one use. A bulk edit writes
 * issue after issue with no pause, so it counts once, not once per issue.
 */
export const FREQUENT_BURST_MS = 10_000;

export type Use = { key: string; at: number };
export type FrequentChoices = { labels: string[]; assignees: string[] };

export const NO_FREQUENT: FrequentChoices = { labels: [], assignees: [] };

/** The promoted keys, most used first; a tie goes to the one used last. */
export function rankFrequent(uses: Use[]): string[] {
  const byKey = new Map<string, { count: number; last: number }>();
  for (const u of [...uses].sort((a, b) => a.at - b.at)) {
    const s = byKey.get(u.key);
    if (!s) byKey.set(u.key, { count: 1, last: u.at });
    else {
      // Measured from the previous add, so a long bulk run stays one use.
      if (u.at - s.last > FREQUENT_BURST_MS) s.count++;
      s.last = u.at;
    }
  }
  return [...byKey]
    .filter(([, s]) => s.count >= FREQUENT_MIN_USES)
    .sort(([, a], [, b]) => b.count - a.count || b.last - a.last)
    .slice(0, FREQUENT_MAX)
    .map(([key]) => key);
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/**
 * Labels by ID and assignees by lower-cased login. A created issue carries its
 * labels by name: `labelIdByName` (lower-cased names) maps them to IDs, and a
 * label that no longer exists is skipped.
 */
export async function frequentChoices(labelIdByName: Map<string, string>, now = Date.now()): Promise<FrequentChoices> {
  const rows = await getDb()
    .select({ field: auditLog.field, next: auditLog.new, at: auditLog.at })
    .from(auditLog)
    .where(and(eq(auditLog.result, "done"), inArray(auditLog.field, ["labels", "assignees", "create"]), gte(auditLog.at, new Date(now - FREQUENT_DAYS * 86_400_000))));
  const labels: Use[] = [];
  const assignees: Use[] = [];
  for (const r of rows) {
    const at = r.at?.getTime();
    const next = r.next as Record<string, unknown> | null;
    if (at == null || !next || typeof next !== "object") continue;
    if (r.field === "labels") for (const id of strings(next.added)) labels.push({ key: id, at });
    else if (r.field === "assignees") for (const login of strings(next.added)) assignees.push({ key: login.toLowerCase(), at });
    else {
      for (const name of strings(next.labelNames)) {
        const id = labelIdByName.get(name.toLowerCase());
        if (id) labels.push({ key: id, at });
      }
      for (const login of strings(next.assigneeLogins)) assignees.push({ key: login.toLowerCase(), at });
    }
  }
  return { labels: rankFrequent(labels), assignees: rankFrequent(assignees) };
}
