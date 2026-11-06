// Issue and PR bodies, one at a time (IMPROVEMENTS S5). The hydrated read
// model no longer carries bodies, so the panels' cache fallback reads the one
// body it needs from Postgres. Without a database (demo, tests) the in-memory
// store still has them.
import { and, eq } from "drizzle-orm";
import { dbDir, getDb } from "@/db";
import { issues, pullRequests } from "@/db/schema";

/** The cached body for an issue or PR node, or `fallback` without a database. */
export async function cachedBody(kind: "issue" | "pr", nodeId: string, fallback: string | null | undefined): Promise<string | null> {
  if (!dbDir()) return fallback ?? null;
  const db = getDb();
  const rows =
    kind === "issue"
      ? await db.select({ body: issues.body }).from(issues).where(eq(issues.ghNodeId, nodeId)).limit(1)
      : await db.select({ body: pullRequests.body }).from(pullRequests).where(eq(pullRequests.ghNodeId, nodeId)).limit(1);
  return rows[0]?.body ?? null;
}

/**
 * An issue or PR the read model no longer holds (S6: deleted, transferred or
 * aged out), looked up by number with its cached body.
 */
export async function removedItem(kind: "issue" | "pr", number: number): Promise<{ body: string | null; reason: string | null } | null> {
  if (!dbDir()) return null;
  const db = getDb();
  const rows =
    kind === "issue"
      ? await db
          .select({ body: issues.body, reason: issues.deletedReason })
          .from(issues)
          .where(and(eq(issues.number, number), eq(issues.deleted, true)))
          .limit(1)
      : await db
          .select({ body: pullRequests.body, reason: pullRequests.deletedReason })
          .from(pullRequests)
          .where(and(eq(pullRequests.number, number), eq(pullRequests.deleted, true)))
          .limit(1);
  return rows[0] ?? null;
}

/** The panel's note for a removed item, or null when it is still on GitHub. */
export function removedNote(kind: "issue" | "pr", reason: string | null): string | null {
  const what = kind === "issue" ? "issue" : "pull request";
  if (reason === "deleted") return `This ${what} is no longer on GitHub (it was deleted). Showing the last cached description.`;
  if (reason === "transferred") return `This ${what} is no longer on GitHub here (it was moved to another repository). Showing the last cached description.`;
  return null;
}
