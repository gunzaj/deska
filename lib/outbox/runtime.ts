// Glue between the durable outbox (store.ts), GitHub and the cache (W1).
import { GitHubWriteClient } from "@/lib/github/write-client";
import { localToken } from "@/lib/github/local-token";
import { importFull } from "@/lib/sync/import";
import type { ProjectFieldMap } from "@/lib/sync/field-map";
import { currentFieldMap } from "@/lib/sync/runtime";
import { readCloseDoneStatus, requireTarget } from "@/lib/settings";
import { getStore } from "@/lib/store";
import { GitHubSource } from "@/lib/sync/source-github";
import type { ReadModel } from "@/lib/sync/read-model";
import { PostgresStore } from "@/lib/sync/store-postgres";
import { partialSnapshot } from "@/lib/sync/types";
import { writeGate } from "@/lib/writes/gate";
import { saveStep, type ProcessDeps } from "./store";

/**
 * The Done Status chosen in Settings (SPEC §4.8, W2) must be one of the
 * discovered Status options: a project need not have an option called "Done", so
 * closing an issue would otherwise set Status to an empty or stale ID. Closing is
 * refused with the reason until one is chosen.
 */
export async function doneStatusOption(store: ReadModel): Promise<{ ok: true; id: string } | { ok: false; reason: string }> {
  const id = await readCloseDoneStatus();
  const ref = store.projectFieldMap().status;
  const status = ref ? store.fields.get(ref.id) : undefined;
  if (!id) return { ok: false, reason: "Choose a Done Status for closing in Settings → Project and fields" };
  if (!status?.options.some((o) => o.id === id)) {
    return { ok: false, reason: "The Done Status chosen for closing is no longer a Status option — choose one in Settings → Project and fields" };
  }
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
  const source = new GitHubSource(token, store, await currentFieldMap(store), await requireTarget());
  const node = (await source.fetchNodes([issueNodeId])).get(issueNodeId);
  if (!node || node.kind !== "issue") return;
  const item = await source.fetchProjectItem(issueNodeId);
  await importFull(partialSnapshot({ issues: [node.issue], projectItems: item ? [item] : [] }), store, { source: "deska" });
}

/** What the outbox needs to write as this user: the stored project (§2.4), its node ID pinned. */
export async function depsFor(token: string, doneStatusOptionId: string, fields: ProjectFieldMap): Promise<ProcessDeps> {
  const target = await requireTarget();
  const gate = await writeGate();
  return {
    client: new GitHubWriteClient(token, fields, target, gate),
    doneStatusOptionId,
    refresh: (id) => refreshIssue(token, id),
    recordStep: (id, step, result) => saveStep(id, step, result),
  };
}

/**
 * The outbox's dependencies for the current token and cache, or null when there
 * is nothing to write with (no token, no project, writes gated off). The worker
 * loop calls the gate first and does not drain while writes are off.
 */
export async function currentDeps(): Promise<ProcessDeps | null> {
  const token = localToken();
  if (!token) return null;
  const store = await getStore();
  const done = await doneStatusOption(store);
  const target = await requireTarget().catch(() => null);
  if (!target) return null;
  return depsFor(token, done.ok ? done.id : "", store.projectFieldMap());
}
