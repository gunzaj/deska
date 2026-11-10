// `ai_results` (SPEC §4.9): a cache of what the model said, with when and by whom.
// Not data: not in backups or exports; "Reset GitHub cache" clears the issue-based rows (lib/backup/local-data.ts).
import { and, desc, eq } from "drizzle-orm";
import { dbDir, getDb } from "@/db";
import { aiResults } from "@/db/schema";

export type StoredResult = typeof aiResults.$inferSelect;

export async function saveResult(r: { feature: string; subjectKind: string; subject: string; inputHash: string; provider: string; model: string; result: unknown; durationMs: number; costUsd: number | null }): Promise<string | null> {
  if (!dbDir()) return null;
  const [row] = await getDb().insert(aiResults).values(r).returning({ id: aiResults.id });
  return row?.id ?? null;
}

/** The newest result for a subject; `fresh` says whether its input hash still matches. */
export async function latestResult(feature: string, subject: string, inputHash: string): Promise<{ row: StoredResult; fresh: boolean } | null> {
  if (!dbDir()) return null;
  const [row] = await getDb().select().from(aiResults).where(and(eq(aiResults.feature, feature), eq(aiResults.subject, subject))).orderBy(desc(aiResults.createdAt)).limit(1);
  return row ? { row, fresh: row.inputHash === inputHash } : null;
}

export async function markResult(id: string, outcome: "accepted" | "dismissed"): Promise<void> {
  if (!dbDir()) return;
  const now = new Date();
  await getDb()
    .update(aiResults)
    .set(outcome === "accepted" ? { acceptedAt: now } : { dismissedAt: now })
    .where(eq(aiResults.id, id));
}
