import { eq, sql } from "drizzle-orm";
import { databaseUrl, getDb } from "@/db";
import { issues } from "@/db/schema";
import { CLOSED_WINDOW_DAYS, findDuplicates, MAX_DUPLICATES, SIMILARITY_THRESHOLD, type DuplicateCandidate } from "@/lib/client/similarity";
import { getStore } from "@/lib/store";

/**
 * Possible duplicates of an issue (F7), read-only: the best title matches among
 * open issues and ones closed in the last 90 days. Postgres uses pg_trgm
 * (`%` with the threshold, GIN-indexed, then `similarity()` to rank); without a
 * database the same measure runs over the in-memory cache. Null: no such issue.
 */
export async function duplicatesOf(number: number): Promise<DuplicateCandidate[] | null> {
  if (!databaseUrl()) {
    const store = await getStore();
    const rows = [...store.issues.values()];
    const self = rows.find((r) => r.number === number);
    return self ? findDuplicates(rows, self) : null;
  }
  return getDb().transaction(async (tx) => {
    const self = (await tx.select({ title: issues.title }).from(issues).where(eq(issues.number, number)).limit(1))[0];
    if (!self) return null;
    // The `%` operator (and its index) compares against this threshold.
    await tx.execute(sql`SELECT set_config('pg_trgm.similarity_threshold', ${String(SIMILARITY_THRESHOLD)}, true)`);
    const res = await tx.execute(sql`
      SELECT number, title, state, url, similarity(title, ${self.title}) AS sim
      FROM issues
      WHERE number <> ${number}
        AND NOT deleted
        AND title % ${self.title}
        AND (state = 'open' OR closed_at >= now() - make_interval(days => ${CLOSED_WINDOW_DAYS}))
      ORDER BY sim DESC, number
      LIMIT ${MAX_DUPLICATES}`);
    return (res.rows as { number: number; title: string; state: string; url: string; sim: number }[]).map((r) => ({
      number: r.number,
      title: r.title,
      state: r.state === "open" ? ("open" as const) : ("closed" as const),
      url: r.url,
      similarity: Math.round(Number(r.sim) * 100) / 100,
    }));
  });
}
