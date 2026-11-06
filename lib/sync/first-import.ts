// The first import from GitHub into an empty cache (SPEC D5), run by the
// in-process sync service after onboarding step 2. Read-only.
//
// It works in checkpointed steps, so quitting (or a crash, or going offline)
// part-way resumes where it stopped on the next launch instead of starting
// over:
//   1. metadata: project fields, issue types, labels, milestones, assignable users;
//   2. open issues, then closed issues of the import window, one REST page at a
//      time, oldest update first: the checkpoint is the last page's newest
//      `updated_at` (`since`, inclusive, so a re-read page is idempotent);
//   3. project items, page by page (scanProject's own cursor checkpoint).
// Every page is written in its own transaction before its checkpoint is
// flushed. Only when all three are done are the sync cursors set, which is
// what tells the app the import finished: until then it shows the progress
// screen, never a half-filled issue list.
import { importFull, type ImportStore } from "./import";
import { scanProject, SyncStopped, type CycleSource } from "./cycle";
import { importClosedCutoff } from "./live";
import type { Kv } from "./poll";
import { partialSnapshot, type FullSnapshot, type SnapshotIssue } from "./types";
import { IMPORT_KEYS, importProgress } from "./import-state";

export { IMPORT_KEYS, importProgress, type ImportPhase, type ImportProgress } from "./import-state";

type GhUser = FullSnapshot["ghUsers"][number];

/** One page of the repository's issues, already mapped (pull requests left out). */
export type IssuePage = {
  issues: SnapshotIssue[];
  /** Assignees on the page (some are no longer assignable). */
  users: GhUser[];
  /** GitHub returned a full page (100 rows, PRs included): there may be more. */
  full: boolean;
  /** The newest `updated_at` on the page, PRs included; null for an empty page. */
  maxUpdatedAt: string | null;
};

/** What the first import reads from GitHub; GitHubImportSource in the app, fakes in tests. */
export interface ImportSource {
  fetchMetadata(): Promise<Pick<FullSnapshot, "projectId" | "fields" | "issueTypes" | "labels" | "milestones">>;
  listAssignableUsers(): Promise<GhUser[]>;
  /** Page `page` (from 1) of issues in `state` updated at or after `since`, oldest update first. */
  issuesPage(state: "open" | "closed", since: string | null, page: number): Promise<IssuePage>;
  scanProjectItems: CycleSource["scanProjectItems"];
}

/**
 * The first poll re-reads issues updated this long before the import began:
 * the local clock and GitHub's may disagree by a little, and a re-read is free
 * of side effects.
 */
export const IMPORT_SINCE_MARGIN_MS = 10 * 60_000;

export type ImportResult = { resumed: boolean; issues: number; items: number };

type Pair = { child: string; parent: string };

function readPairs(kv: Kv): Pair[] {
  try {
    const v = JSON.parse(kv.get(IMPORT_KEYS.pendingParents) || "[]");
    return Array.isArray(v) ? v.filter((p): p is Pair => typeof p?.child === "string" && typeof p?.parent === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Run (or resume) the first import. Callers hold the sync lock. With
 * `signal` aborted it stops between pages, after the last page's checkpoint,
 * by throwing SyncStopped. Any other failure throws as well; the checkpoint
 * stays, and the next call continues from it.
 */
export async function runFirstImport(
  source: ImportSource,
  store: ImportStore,
  kv: Kv,
  opts: { now?: () => Date; signal?: AbortSignal; onProgress?: () => void } = {},
): Promise<ImportResult> {
  const now = opts.now ?? (() => new Date());
  const checkpoint = async () => {
    await kv.flush?.();
    opts.onProgress?.();
    if (opts.signal?.aborted) throw new SyncStopped();
  };
  const count = (key: string, add: number) => kv.set(key, String((Number(kv.get(key)) || 0) + add));

  let phase = importProgress(kv).phase;
  const resumed = phase !== null;
  // Recorded, not inferred: `import.issues` counts across the pages of one run, so a
  // fresh import past its first page has issues > 0 without anything to resume. The
  // screen reads this key, and it is cleared with the rest on success.
  kv.set(IMPORT_KEYS.resumed, resumed ? "1" : "0");
  if (!phase) {
    const start = now();
    kv.set(IMPORT_KEYS.startedAt, start.toISOString());
    kv.set(IMPORT_KEYS.cutoff, importClosedCutoff(start.getTime()));
    kv.set(IMPORT_KEYS.issues, "0");
    kv.set(IMPORT_KEYS.items, "0");
    kv.set(IMPORT_KEYS.itemsTotal, "");
    kv.set(IMPORT_KEYS.pendingParents, "[]");
    kv.set(IMPORT_KEYS.phase, (phase = "metadata"));
    await checkpoint();
  }

  if (phase === "metadata") {
    const meta = await source.fetchMetadata();
    const users = await source.listAssignableUsers();
    await importFull(partialSnapshot({ ...meta, ghUsers: users }), store);
    kv.set(IMPORT_KEYS.since, "");
    kv.set(IMPORT_KEYS.page, "1");
    kv.set(IMPORT_KEYS.phase, (phase = "open"));
    await checkpoint();
  }

  while (phase === "open" || phase === "closed") {
    const state: "open" | "closed" = phase;
    // Closed issues: only those updated within the import window (S6).
    const since = kv.get(IMPORT_KEYS.since) || (state === "closed" ? kv.get(IMPORT_KEYS.cutoff) || importClosedCutoff(now().getTime()) : null);
    const page = Math.max(1, Number(kv.get(IMPORT_KEYS.page)) || 1);
    const res = await source.issuesPage(state, since, page);
    if (res.users.length) await importFull(partialSnapshot({ ghUsers: res.users }), store);
    // Pages overlap by the rows that share the boundary `updated_at`: count new rows only.
    count(IMPORT_KEYS.issues, (await importFull(partialSnapshot({ issues: res.issues }), store)).inserted);

    // A parent on a later page (or not cached yet) can't be linked while its
    // page is written: keep the link and retry it after each page.
    if (store.linkParents) {
      const pairs = [...readPairs(kv), ...res.issues.flatMap((i) => (i.parentNodeId ? [{ child: i.nodeId, parent: i.parentNodeId }] : []))];
      const unresolved = pairs.length ? await store.linkParents(pairs) : [];
      kv.set(IMPORT_KEYS.pendingParents, JSON.stringify(unresolved));
    }

    if (!res.full || !res.maxUpdatedAt) {
      // The last page: on to closed issues, or to the project.
      kv.set(IMPORT_KEYS.since, "");
      kv.set(IMPORT_KEYS.page, "1");
      kv.set(IMPORT_KEYS.phase, (phase = state === "open" ? "closed" : "items"));
    } else if (!since || res.maxUpdatedAt > since) {
      // Step the window forward: the next request starts at this page's newest update.
      kv.set(IMPORT_KEYS.since, res.maxUpdatedAt);
      kv.set(IMPORT_KEYS.page, "1");
    } else {
      // A full page that all shares one `updated_at` (a bulk edit): page on within it.
      kv.set(IMPORT_KEYS.page, String(page + 1));
    }
    await checkpoint();
  }

  if (phase === "items") {
    const startedIso = now().toISOString();
    await scanProject(source, store, kv, startedIso, {
      signal: opts.signal,
      onPage: (items, total) => {
        count(IMPORT_KEYS.items, items);
        if (total != null) kv.set(IMPORT_KEYS.itemsTotal, String(total));
        opts.onProgress?.();
      },
    });
  }

  // Done: seed the cursors the cycles start from. The first poll re-reads
  // whatever changed since the import began (with a margin for clock skew).
  const progress = importProgress(kv);
  const started = Date.parse(kv.get(IMPORT_KEYS.startedAt) ?? "");
  const nowIso = now().toISOString();
  kv.set("issues.since", new Date((Number.isFinite(started) ? started : Date.parse(nowIso)) - IMPORT_SINCE_MARGIN_MS).toISOString());
  // A fresh cursor needs a fresh ETag; an old one could answer 304 for it.
  kv.set("issues.etag", "");
  kv.set("sync.lastSync", nowIso);
  kv.set("project.lastScan", nowIso);
  kv.set("prs.lastScan", nowIso);
  // A fresh import is as good as a reconcile.
  kv.set("reconcile.lastRun", nowIso);
  for (const key of Object.values(IMPORT_KEYS)) kv.set(key, "");
  await kv.flush?.();
  opts.onProgress?.();
  return { resumed, issues: progress.issues, items: progress.items };
}
