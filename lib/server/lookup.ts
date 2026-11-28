// Find an issue the cache doesn't hold, by its number. The first import takes
// every open issue but only the closed ones updated inside its window, so an
// older closed issue is unknown to Deska until someone asks for it. Read-only:
// two GraphQL queries with the viewer's own token, then a write to the cache.
import { dbDir } from "@/db";
import { localToken } from "@/lib/github/local-token";
import { requireTarget } from "@/lib/settings";
import { getStore, invalidateReadCache } from "@/lib/store";
import { importFull } from "@/lib/sync/import";
import { redactError } from "@/lib/sync/health";
import { currentFieldMap } from "@/lib/sync/runtime";
import { GitHubSource, isRateLimitError } from "@/lib/sync/source-github";
import { PostgresStore } from "@/lib/sync/store-postgres";
import { partialSnapshot } from "@/lib/sync/types";

export type IssueLookup =
  | { found: true; cached: boolean }
  | {
      found: false;
      reason: "not-found" | "sample-data" | "not-connected" | "rate-limited" | "failed";
    };

/** Make issue `number` part of the cache if GitHub has it in the configured repository. */
export async function lookupIssue(number: number): Promise<IssueLookup> {
  const cache = await getStore();
  for (const i of cache.issues.values()) if (i.number === number) return { found: true, cached: true };
  if (!dbDir()) return { found: false, reason: "sample-data" };
  const token = localToken();
  if (!token) return { found: false, reason: "not-connected" };
  try {
    const store = new PostgresStore();
    const source = new GitHubSource(token, store, await currentFieldMap(store), await requireTarget());
    const nodeId = await source.issueNodeId(number);
    if (!nodeId) return { found: false, reason: "not-found" };
    const node = (await source.fetchNodes([nodeId])).get(nodeId);
    if (!node || node.kind !== "issue" || node.repo.toLowerCase() !== source.repoName.toLowerCase()) return { found: false, reason: "not-found" };
    const item = await source.fetchProjectItem(nodeId);
    await importFull(
      partialSnapshot({
        issues: [node.issue],
        projectItems: item ? [item] : [],
      }),
      store,
    );
    invalidateReadCache();
    return { found: true, cached: false };
  } catch (e) {
    if (isRateLimitError(e)) return { found: false, reason: "rate-limited" };
    console.error("issue lookup failed:", redactError(e));
    return { found: false, reason: "failed" };
  }
}
