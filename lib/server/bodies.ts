// Issue bodies, one at a time (IMPROVEMENTS S5). The hydrated read model no
// longer carries bodies, so the panel's cache fallback reads the one body it
// needs from Postgres. Without a database (demo, tests) the in-memory store
// still has them.
import { and, eq } from "drizzle-orm";
import { dbDir, getDb } from "@/db";
import { issues } from "@/db/schema";

/** The cached body for an issue node, or `fallback` without a database. */
export async function cachedBody(nodeId: string, fallback: string | null | undefined): Promise<string | null> {
  if (!dbDir()) return fallback ?? null;
  const rows = await getDb().select({ body: issues.body }).from(issues).where(eq(issues.ghNodeId, nodeId)).limit(1);
  return rows[0]?.body ?? null;
}

/**
 * An issue the read model no longer holds (S6: deleted, transferred or aged
 * out), looked up by number with its cached body.
 */
export async function removedItem(number: number): Promise<{ body: string | null; reason: string | null } | null> {
  if (!dbDir()) return null;
  const rows = await getDb()
    .select({ body: issues.body, reason: issues.deletedReason })
    .from(issues)
    .where(and(eq(issues.number, number), eq(issues.deleted, true)))
    .limit(1);
  return rows[0] ?? null;
}

/** The panel's note for a removed issue, or null when it is still on GitHub. */
export function removedNote(reason: string | null): string | null {
  if (reason === "deleted") return "This issue is no longer on GitHub (it was deleted). Showing the last cached description.";
  if (reason === "transferred") return "This issue is no longer on GitHub here (it was moved to another repository). Showing the last cached description.";
  return null;
}
