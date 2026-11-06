import { ITEM_FIELD_PROPS, RESTORE_WINDOW_MS, setValue, type ChangeSource, type ImportOptions, type TrackedField } from "./changes";
import type { ImportStore, StoreStats } from "./import";
import { newerItem } from "./item-rules";
import { normalizePullRequest } from "./prs";
import { fieldRow, ReadModel } from "./read-model";
import type { IdResolver } from "./poll";
import type { IssueRow } from "./read-model";
import type { FullSnapshot, SnapshotField, SnapshotIssue, SnapshotProjectItem, SnapshotPullRequest, SnapshotTeam } from "./types";

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * In-memory ImportStore: the sync test double, the demo store and the one-off
 * scripts. The read model it extends is what pages read; the import and
 * change tracking below mirror what PostgresStore does, rules included
 * (tests/sync/store-contract.test.ts runs both).
 */
export class MemoryStore extends ReadModel implements ImportStore, IdResolver {
  private source: ChangeSource = "sync";
  private fresh = new Set<string>();

  /**
   * Row by row, in the order PostgresStore writes a snapshot: metadata, issues
   * and their relations, project items, pull requests, teams. The change
   * tracking (F0) and the scan's seen list are part of the same call.
   */
  async importSnapshot(snapshot: FullSnapshot, opts: ImportOptions = {}): Promise<StoreStats> {
    this.beginImport(opts);
    const stats: StoreStats = { inserted: 0, updated: 0, unchanged: 0 };
    const tally = (r: "inserted" | "updated" | "unchanged") => void (stats[r] += 1);

    for (const [i, f] of snapshot.fields.entries()) tally(this.upsertField(f, snapshot.projectId, i));
    for (const t of snapshot.issueTypes) tally(this.upsertIssueType(t));
    for (const l of snapshot.labels) tally(this.upsertLabel(l));
    for (const m of snapshot.milestones) tally(this.upsertMilestone(m));
    for (const u of snapshot.ghUsers) tally(this.upsertGhUser(u));

    const realIssues = snapshot.issues.filter((i) => !i.isPullRequest);
    for (const i of realIssues) tally(this.upsertIssue(i));
    for (const i of realIssues) {
      // A partial (incremental) payload omits parentNodeId; only relink when the
      // source actually told us something, otherwise we would detach every
      // sub-issue on each poll.
      if (i.parentNodeId !== undefined) tally(this.linkParent(i.nodeId, i.parentNodeId));
      tally(this.setIssueLabels(i.nodeId, i.labelIds));
      tally(this.setIssueAssignees(i.nodeId, i.assigneeIds));
    }
    for (const p of snapshot.projectItems) tally(this.upsertProjectItem(p));
    for (const pr of snapshot.pullRequests ?? []) tally(this.upsertPullRequest(pr));
    for (const t of snapshot.teams ?? []) tally(this.setTeamMembers(t));
    // Every item the page listed counts as seen, including ones skipped above.
    if (opts.scanId) this.markScanSeen(opts.scanId, snapshot.projectItems.map((p) => p.itemId));
    return stats;
  }

  beginImport(opts: ImportOptions) {
    this.source = opts.source ?? "sync";
    this.fresh = new Set();
  }

  private record(issueNodeId: string, field: TrackedField, oldValue: string | null, newValue: string | null, source: ChangeSource = this.source) {
    if (oldValue === newValue || this.fresh.has(issueNodeId)) return;
    this.fieldChanges.push({ issueNodeId, field, oldValue, newValue, observedAt: new Date().toISOString(), source });
  }

  /** When each item was last written, and when an issue's item was last pruned (v5 1.4). */
  private touchedAt = new Map<string, number>();
  private prunedAt = new Map<string, number>();

  // Indexes for IdResolver, rebuilt on demand so callers cannot desync them.
  private labelIdByName() {
    const m = new Map<string, string>();
    for (const [id, l] of this.labels) m.set(l.name.toLowerCase(), id);
    return m;
  }

  private userIdByLogin() {
    const m = new Map<string, string>();
    for (const [id, u] of this.ghUsers) m.set(u.login.toLowerCase(), id);
    return m;
  }

  private milestoneIdByNumber() {
    const m = new Map<number, string>();
    for (const [id, ms] of this.milestones) m.set(ms.number, id);
    return m;
  }

  labelId(name: string): string {
    const found = this.labelIdByName().get(name.toLowerCase());
    if (found) return found;
    // Provisional ID: the name is itself stable, and upsertLabel re-keys this
    // entry to the real node ID once a full import discovers the label.
    this.labels.set(name, { name, color: "", description: "" });
    return name;
  }

  userId(login: string): string {
    const found = this.userIdByLogin().get(login.toLowerCase());
    if (found) return found;
    this.ghUsers.set(login, { login, avatarUrl: null });
    return login;
  }

  milestoneId(number: number): string | null {
    const found = this.milestoneIdByNumber().get(number);
    if (found) return found;
    // Provisional ID: upsertMilestone re-keys it to the real node ID once a full
    // import discovers the milestone (mirrors labelId/userId).
    const id = `ms:${number}`;
    this.milestones.set(id, { number, title: "", state: "open", dueOn: null });
    return id;
  }

  /**
   * import.ts always upserts an issue before linking children or replacing its
   * label/assignee sets, so a missing row is an invariant violation rather than
   * a no-op — fail loudly instead of reporting "unchanged" and losing the write.
   */
  private issueRow(nodeId: string): IssueRow {
    const row = this.issues.get(nodeId);
    if (!row) throw new Error(`issue ${nodeId} missing from store before relation update`);
    return row;
  }

  upsertField(f: SnapshotField, projectId: string, position: number) {
    const next = fieldRow(f, projectId, position);
    const prev = this.fields.get(f.id);
    if (!prev) {
      this.fields.set(f.id, next);
      return "inserted" as const;
    }
    if (same(prev, next)) return "unchanged" as const;
    this.fields.set(f.id, next);
    return "updated" as const;
  }

  upsertIssueType(t: { id: string; name: string; color: string; description: string }) {
    const prev = this.issueTypes.get(t.id);
    const next = { name: t.name, color: t.color, description: t.description };
    if (!prev) {
      this.issueTypes.set(t.id, next);
      return "inserted" as const;
    }
    if (same(prev, next)) return "unchanged" as const;
    this.issueTypes.set(t.id, next);
    return "updated" as const;
  }

  upsertLabel(l: { id: string; name: string; color: string; description: string }) {
    const next = { name: l.name, color: l.color, description: l.description };
    // A provisional entry created by labelId() is keyed by name; re-key it to
    // the real node ID so nothing points at a stale identity.
    for (const [id, existing] of this.labels) {
      if (id !== l.id && existing.name.toLowerCase() === l.name.toLowerCase()) {
        this.labels.delete(id);
        this.rekeyLabelRefs(id, l.id);
      }
    }
    const prev = this.labels.get(l.id);
    if (!prev) {
      this.labels.set(l.id, next);
      return "inserted" as const;
    }
    if (same(prev, next)) return "unchanged" as const;
    this.labels.set(l.id, next);
    return "updated" as const;
  }

  private rekeyLabelRefs(fromId: string, toId: string) {
    for (const issue of this.issues.values()) {
      const i = issue.labelIds.indexOf(fromId);
      if (i !== -1) issue.labelIds[i] = toId;
    }
    for (const [id, pr] of this.pullRequests) {
      if (pr.labelIds.includes(fromId)) {
        this.pullRequests.set(id, normalizePullRequest({ ...pr, labelIds: pr.labelIds.map((l) => (l === fromId ? toId : l)) }));
      }
    }
  }

  upsertMilestone(m: { id: string; number: number; title: string; state: string; dueOn: string | null }) {
    const next = { number: m.number, title: m.title, state: m.state, dueOn: m.dueOn };
    // A provisional entry created by milestoneId() is keyed by "ms:<number>";
    // re-key its references to the real node ID.
    for (const [id, existing] of this.milestones) {
      if (id !== m.id && existing.number === m.number) {
        this.milestones.delete(id);
        this.rekeyMilestoneRefs(id, m.id);
      }
    }
    const prev = this.milestones.get(m.id);
    if (!prev) {
      this.milestones.set(m.id, next);
      return "inserted" as const;
    }
    if (same(prev, next)) return "unchanged" as const;
    this.milestones.set(m.id, next);
    return "updated" as const;
  }

  private rekeyMilestoneRefs(fromId: string, toId: string) {
    for (const issue of this.issues.values()) {
      if (issue.milestoneId === fromId) issue.milestoneId = toId;
    }
    for (const [id, pr] of this.pullRequests) {
      if (pr.milestoneId === fromId) {
        this.pullRequests.set(id, normalizePullRequest({ ...pr, milestoneId: toId }));
      }
    }
  }

  upsertGhUser(u: { githubId: string; login: string; avatarUrl: string | null }) {
    const next = { login: u.login, avatarUrl: u.avatarUrl };
    for (const [id, existing] of this.ghUsers) {
      if (id !== u.githubId && existing.login.toLowerCase() === u.login.toLowerCase()) {
        this.ghUsers.delete(id);
        this.rekeyAssigneeRefs(id, u.githubId);
      }
    }
    const prev = this.ghUsers.get(u.githubId);
    if (!prev) {
      this.ghUsers.set(u.githubId, next);
      return "inserted" as const;
    }
    if (same(prev, next)) return "unchanged" as const;
    this.ghUsers.set(u.githubId, next);
    return "updated" as const;
  }

  private rekeyAssigneeRefs(fromId: string, toId: string) {
    for (const issue of this.issues.values()) {
      const i = issue.assigneeIds.indexOf(fromId);
      if (i !== -1) issue.assigneeIds[i] = toId;
    }
    for (const [id, pr] of this.pullRequests) {
      if (pr.assigneeIds.includes(fromId)) {
        this.pullRequests.set(id, normalizePullRequest({ ...pr, assigneeIds: pr.assigneeIds.map((a) => (a === fromId ? toId : a)) }));
      }
    }
  }

  upsertIssue(i: SnapshotIssue) {
    const prev = this.issues.get(i.nodeId);
    const next: IssueRow = {
      nodeId: i.nodeId,
      number: i.number,
      title: i.title,
      // `undefined` = absent (the read model carries no bodies, S5): keep.
      body: i.body === undefined ? (prev?.body ?? null) : i.body,
      state: i.state,
      stateReason: i.stateReason,
      // `undefined` = absent from a partial payload, so keep the stored value.
      typeId: i.typeId === undefined ? (prev?.typeId ?? null) : i.typeId,
      milestoneId: i.milestoneId,
      parentNodeId:
        i.parentNodeId === undefined ? (prev?.parentNodeId ?? null) : i.parentNodeId,
      authorLogin: i.authorLogin,
      url: i.url,
      createdAt: i.createdAt,
      updatedAt: i.updatedAt,
      closedAt: i.closedAt,
      labelIds: [...i.labelIds],
      assigneeIds: [...i.assigneeIds],
    };
    if (!prev) {
      this.fresh.add(i.nodeId);
      this.putIssue(next);
      return "inserted" as const;
    }
    this.record(i.nodeId, "state", prev.state, next.state);
    if (same(prev, next)) return "unchanged" as const;
    this.putIssue(next);
    return "updated" as const;
  }

  linkParent(childNodeId: string, parentNodeId: string | null) {
    const row = this.issueRow(childNodeId);
    if (row.parentNodeId === parentNodeId) return "unchanged" as const;
    row.parentNodeId = parentNodeId;
    return "updated" as const;
  }

  setIssueLabels(nodeId: string, labelIds: string[]) {
    const row = this.issueRow(nodeId);
    if (same([...row.labelIds].sort(), [...labelIds].sort())) {
      return "unchanged" as const;
    }
    this.record(nodeId, "labels", setValue(row.labelIds), setValue(labelIds));
    row.labelIds = [...labelIds];
    return "updated" as const;
  }

  setIssueAssignees(nodeId: string, assigneeIds: string[]) {
    const row = this.issueRow(nodeId);
    if (same([...row.assigneeIds].sort(), [...assigneeIds].sort())) {
      return "unchanged" as const;
    }
    this.record(nodeId, "assignees", setValue(row.assigneeIds), setValue(assigneeIds));
    row.assigneeIds = [...assigneeIds];
    return "updated" as const;
  }

  upsertPullRequest(pr: SnapshotPullRequest) {
    const prev = this.pullRequests.get(pr.nodeId);
    const next = normalizePullRequest(structuredClone(pr));
    if (!prev) {
      this.pullRequests.set(pr.nodeId, next);
      return "inserted" as const;
    }
    if (same(prev, next)) return "unchanged" as const;
    this.pullRequests.set(pr.nodeId, next);
    return "updated" as const;
  }

  setTeamMembers(t: SnapshotTeam) {
    const next = [...new Set(t.members.map((m) => m.toLowerCase()))].sort();
    const prev = this.teams.get(t.slug);
    if (same(prev, next)) return "unchanged" as const;
    this.teams.set(t.slug, next);
    return prev ? ("updated" as const) : ("inserted" as const);
  }

  private scanSeen = new Map<string, Set<string>>();

  markScanSeen(scanId: string, itemIds: string[]) {
    const seen = this.scanSeen.get(scanId) ?? new Set<string>();
    for (const id of itemIds) seen.add(id);
    this.scanSeen.set(scanId, seen);
  }

  resetScanSeen() {
    this.scanSeen.clear();
  }

  pruneUnseenProjectItems(scanId: string, startedAt?: string) {
    const keep = this.scanSeen.get(scanId) ?? new Set<string>();
    this.scanSeen.delete(scanId);
    // An empty scan is far more likely a misconfiguration than an empty project.
    if (!keep.size) return 0;
    let removed = 0;
    const since = startedAt ? Date.parse(startedAt) : Number.POSITIVE_INFINITY;
    for (const [id, item] of [...this.projectItems]) {
      // Written after the scan began: the scan cannot have meant to miss it.
      if (!keep.has(id) && (this.touchedAt.get(id) ?? 0) < since) {
        this.dropItem(id);
        this.prunedAt.set(item.issueNodeId, Date.now());
        removed += 1;
      }
    }
    return removed;
  }

  upsertProjectItem(p: SnapshotProjectItem) {
    // Items whose issue isn't cached (other repos, old closed issues) are skipped.
    if (!this.issues.has(p.issueNodeId)) return "unchanged" as const;
    const prev = this.projectItems.get(p.itemId);
    const next = { ...p };
    // One item per issue (S7): when GitHub reports two, the more recently
    // updated one is kept and the other dropped.
    const other = this.itemForIssue(p.issueNodeId);
    const replaces = other && other.itemId !== p.itemId ? other : null;
    if (replaces && !newerItem(p, replaces)) return "unchanged" as const;
    // The issue's project fields before this write, whichever item held them.
    const was = prev ?? this.itemForIssue(p.issueNodeId);
    // An item that comes back a moment after a prune is a restore, not scope added.
    const prunedAt = this.prunedAt.get(p.issueNodeId);
    const restored = !was && prunedAt !== undefined && Date.now() - prunedAt <= RESTORE_WINDOW_MS;
    if (restored) this.prunedAt.delete(p.issueNodeId);
    for (const [field, prop] of ITEM_FIELD_PROPS) this.record(p.issueNodeId, field, was?.[prop] ?? null, p[prop] ?? null, restored ? "restore" : this.source);
    this.touchedAt.set(p.itemId, Date.now());
    if (replaces) {
      this.dropItem(replaces.itemId);
      this.putItem(next);
      return "updated" as const;
    }
    if (!prev) {
      this.putItem(next);
      return "inserted" as const;
    }
    if (same(prev, next)) return "unchanged" as const;
    this.putItem(next);
    return "updated" as const;
  }
}
