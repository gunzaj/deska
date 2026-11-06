// Glue between the durable outbox (store.ts), GitHub and the cache (W1).
import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { decryptToken } from "@/lib/crypto";
import { GitHubWriteClient } from "@/lib/github/write-client";
import { importFull } from "@/lib/sync/import";
import type { ProjectFieldMap } from "@/lib/sync/field-map";
import { currentFieldMap } from "@/lib/sync/runtime";
import { GitHubSource } from "@/lib/sync/source-github";
import type { ReadModel } from "@/lib/sync/read-model";
import { PostgresStore } from "@/lib/sync/store-postgres";
import { partialSnapshot } from "@/lib/sync/types";
import { writeEnabled } from "./queue";
import { drainOutbox, type DrainOptions, type ProcessDeps } from "./store";

/**
 * STATUS_DONE_OPTION_ID must name one of the discovered Status options: a
 * project need not have an option called "Done", so closing an issue would
 * otherwise set Status to an empty or stale ID.
 */
export function doneStatusOption(store: ReadModel, raw = process.env.STATUS_DONE_OPTION_ID): { ok: true; id: string } | { ok: false; reason: string } {
  const id = raw?.trim() ?? "";
  const ref = store.projectFieldMap().status;
  const status = ref ? store.fields.get(ref.id) : undefined;
  if (!id || !status?.options.some((o) => o.id === id)) return { ok: false, reason: "STATUS_DONE_OPTION_ID not set or unknown" };
  return { ok: true, id };
}

/**
 * Re-read one issue and its project item from GitHub with the acting user's
 * token and write them to the cache. A change bumps sync.generation, so every
 * client picks it up; the next edit then compares against fresh data instead
 * of reporting a false conflict.
 */
export async function refreshIssue(token: string, issueNodeId: string): Promise<void> {
  const store = new PostgresStore();
  const source = new GitHubSource(token, store, await currentFieldMap(store));
  const node = (await source.fetchNodes([issueNodeId])).get(issueNodeId);
  if (!node || node.kind !== "issue") return;
  const item = await source.fetchProjectItem(issueNodeId);
  await importFull(partialSnapshot({ issues: [node.issue], projectItems: item ? [item] : [] }), store, { source: "deska" });
}

/** What the outbox needs to write as this user. */
export function depsFor(token: string, doneStatusOptionId: string, fields: ProjectFieldMap): ProcessDeps {
  return { client: new GitHubWriteClient(token, fields), doneStatusOptionId, refresh: (id) => refreshIssue(token, id) };
}

/** The user's GitHub token stored at sign-in, for writes nobody is waiting on. */
export async function storedToken(login: string): Promise<string | null> {
  const [row] = await getDb()
    .select({ enc: users.tokenEnc })
    .from(users)
    .where(eq(sql`lower(${users.login})`, login.toLowerCase()))
    .limit(1);
  if (!row?.enc) return null;
  try {
    return decryptToken(row.enc);
  } catch {
    return null;
  }
}

/**
 * Drain leftover edits (worker loop, cron). No-op while writes are off: a
 * row can only exist if they were on, and nothing may be written now.
 */
export async function drainLeftovers(doneStatusOptionId: string, opts: DrainOptions = {}): Promise<number> {
  if (!writeEnabled()) return 0;
  const fields = await currentFieldMap(new PostgresStore());
  const { processed } = await drainOutbox(async (login) => {
    const token = await storedToken(login);
    return token ? depsFor(token, doneStatusOptionId, fields) : null;
  }, opts);
  return processed.length;
}
