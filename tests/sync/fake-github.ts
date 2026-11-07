// A fake GitHub for the sync service and first-import tests (D5): the
// fictional acme/widgets fixture plus generated issues, served through the
// interfaces the sync code reads (ImportSource, CycleSource, ReconcileSource).
// Nothing here touches the network.
import { fixtureSnapshot } from "@/lib/demo/fixtures";
import type { CycleSource } from "@/lib/sync/cycle";
import type { ImportSource, IssuePage } from "@/lib/sync/first-import";
import type { ReconcileSource } from "@/lib/sync/reconcile";
import type { FetchedNode } from "@/lib/sync/source-github";
import type { SnapshotIssue, SnapshotProjectItem } from "@/lib/sync/types";

export type Failure = null | "unauthorized" | "offline";

export const httpError = (status: number, message: string) => Object.assign(new Error(message), { status });

export type FakeGitHub = ReturnType<typeof fakeGitHub>;

/**
 * `extra` generated open issues (#200…) on top of the fixture's three; each
 * page holds `pageSize` rows. `gate`, when set, is awaited before every issue
 * page (a test holds the import there).
 */
export function fakeGitHub(opts: { extra?: number; pageSize?: number } = {}) {
  const fx = fixtureSnapshot(new Date("2026-10-20T00:00:00Z"));
  const pageSize = opts.pageSize ?? 2;
  const issues: SnapshotIssue[] = fx.issues.filter((i) => !i.isPullRequest).map((i) => ({ ...i }));
  for (let n = 0; n < (opts.extra ?? 0); n++) {
    const at = new Date(Date.UTC(2026, 9, 5, 0, n)).toISOString();
    issues.push({
      nodeId: `I_gen_${n}`,
      number: 200 + n,
      title: `Generated issue ${n}`,
      body: "",
      state: "open",
      stateReason: null,
      typeId: "IT_acme_task",
      milestoneId: null,
      parentNodeId: null,
      authorLogin: "carol",
      url: `https://github.com/acme/widgets/issues/${200 + n}`,
      createdAt: at,
      updatedAt: at,
      closedAt: null,
      labelIds: [],
      assigneeIds: [],
    });
  }
  // The child (#101) is older than its parent (#100): with oldest-first pages
  // the parent arrives on a later page.
  const sub = issues.find((i) => i.number === 101)!;
  sub.updatedAt = "2026-09-20T00:00:00Z";
  const items: SnapshotProjectItem[] = fx.projectItems.map((p) => ({ ...p }));

  const gh = {
    issues,
    items,
    fail: null as Failure,
    gate: null as Promise<void> | null,
    calls: { metadata: 0, users: 0, issuePages: [] as { state: string; since: string | null; page: number }[], itemPages: 0, changeChecks: [] as (string | null)[], reconcile: 0 },
    check() {
      if (gh.fail === "unauthorized") throw httpError(401, "Bad credentials");
      if (gh.fail === "offline") throw httpError(500, "fetch failed");
    },
    /** Change an issue on GitHub (bumps its updated_at to `at`). */
    edit(number: number, patch: Partial<SnapshotIssue>, at = new Date().toISOString()) {
      const i = gh.issues.find((x) => x.number === number)!;
      Object.assign(i, patch, { updatedAt: at });
    },
    importSource(): ImportSource {
      return {
        async fetchMetadata() {
          gh.check();
          gh.calls.metadata++;
          return { projectId: fx.projectId, fields: fx.fields, issueTypes: fx.issueTypes, labels: fx.labels, milestones: fx.milestones };
        },
        async listAssignableUsers() {
          gh.check();
          gh.calls.users++;
          return fx.ghUsers;
        },
        async issuesPage(state, since, page): Promise<IssuePage> {
          if (gh.gate) await gh.gate;
          gh.check();
          gh.calls.issuePages.push({ state, since, page });
          const rows = gh.issues
            .filter((i) => i.state === state && (!since || i.updatedAt >= since))
            .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt) || a.number - b.number)
            .slice((page - 1) * pageSize, page * pageSize);
          return {
            issues: rows.map((i) => ({ ...i })),
            users: [],
            full: rows.length === pageSize,
            maxUpdatedAt: rows.reduce<string | null>((m, i) => (!m || i.updatedAt > m ? i.updatedAt : m), null),
          };
        },
        scanProjectItems: (cursor) => gh.scanProjectItems(cursor),
      };
    },
    async scanProjectItems(cursor: string | null) {
      gh.check();
      gh.calls.itemPages++;
      const start = Number(cursor ?? 0);
      const page = gh.items.slice(start, start + pageSize).map((p) => ({ ...p }));
      const next = start + pageSize < gh.items.length ? String(start + pageSize) : null;
      return { items: page, nextCursor: next, total: gh.items.length };
    },
    cycleSource(): CycleSource {
      return {
        async checkChanges(since) {
          gh.check();
          gh.calls.changeChecks.push(since);
          const rows = gh.issues.filter((i) => !since || i.updatedAt >= since).map((i) => ({ ...i, typeId: undefined, parentNodeId: undefined }));
          if (!rows.length) return { kind: "not-modified" };
          const newest = rows.reduce((m, i) => (i.updatedAt > m ? i.updatedAt : m), since ?? "");
          return { kind: "changed", issues: rows, items: [], etag: "", since: newest };
        },
        scanProjectItems: (cursor) => gh.scanProjectItems(cursor),
      };
    },
    reconcileSource(): ReconcileSource {
      return {
        async fetchMetadata() {
          gh.check();
          gh.calls.reconcile++;
          return { projectId: fx.projectId, fields: fx.fields, issueTypes: fx.issueTypes, labels: fx.labels, milestones: fx.milestones };
        },
        async listOpenNodeIds() {
          return { issues: gh.issues.filter((i) => i.state === "open").map((i) => i.nodeId) };
        },
        async fetchNodes(ids) {
          return new Map<string, FetchedNode | null>(ids.map((id) => [id, null]));
        },
        repoName: "acme/widgets",
      };
    },
  };
  return gh;
}

/** A gate a test opens by hand. */
export function gate(): { promise: Promise<void>; open: () => void } {
  let open!: () => void;
  const promise = new Promise<void>((r) => (open = r));
  return { promise, open };
}
