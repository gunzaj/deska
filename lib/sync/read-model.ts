// The read model: what the pages, APIs and outbox read, built in bulk from a
// stored snapshot (v5 4.4). It has no import or change-tracking logic; that
// lives in MemoryStore (the sync test double and the demo store) and in
// PostgresStore (production writes).
import type { FieldChange } from "./changes";
import { effectiveMapping, missingFields, type FieldMapping, type MissingField } from "./field-map";
import { normalizePullRequest } from "./prs";
import type { FullSnapshot, SnapshotField, SnapshotProjectItem, SnapshotPullRequest } from "./types";

export type IssueRow = {
  nodeId: string;
  number: number;
  title: string;
  body: string | null;
  state: string;
  stateReason: string | null;
  typeId: string | null;
  milestoneId: string | null;
  parentNodeId: string | null;
  authorLogin: string;
  url: string;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  labelIds: string[];
  assigneeIds: string[];
};

export type FieldRow = {
  name: string;
  dataType: string;
  projectId: string;
  position: number;
  options: { id: string; name: string; color: string; position: number }[];
  iterations: { id: string; title: string; startDate: string; duration: number }[];
};

export type ItemRow = SnapshotProjectItem & { issueNodeId: string };

/** The stored shape of a project field, options and iterations included. */
export function fieldRow(f: SnapshotField, projectId: string, position: number): FieldRow {
  return {
    name: f.name,
    dataType: f.dataType,
    projectId,
    position,
    options: (f.options ?? []).map((o, i) => ({ ...o, position: i })),
    iterations: (f.iterations ?? []).map((it) => ({ ...it })),
  };
}

export class ReadModel {
  fields = new Map<string, FieldRow>();
  issueTypes = new Map<string, { name: string; color: string; description: string }>();
  labels = new Map<string, { name: string; color: string; description: string }>();
  milestones = new Map<string, { number: number; title: string; state: string; dueOn: string | null }>();
  ghUsers = new Map<string, { login: string; avatarUrl: string | null }>();
  issues = new Map<string, IssueRow>();
  projectItems = new Map<string, ItemRow>();
  pullRequests = new Map<string, SnapshotPullRequest>();
  teams = new Map<string, string[]>();

  /**
   * Field change history (F0) of the in-memory demo store, which `listFieldChanges`
   * reads without a database. Production reads `issue_field_changes` instead.
   * Only changes to issues already cached are recorded.
   */
  fieldChanges: FieldChange[] = [];

  /** A model built in bulk from a snapshot that is already consistent (what `readSnapshot` returns). */
  static fromSnapshot(s: FullSnapshot, mapping: FieldMapping | null = null): ReadModel {
    const model = new ReadModel();
    model.loadSnapshot(s);
    model.mapping = mapping;
    return model;
  }

  get issueCount() {
    return this.issues.size;
  }

  /**
   * Fill an empty model from a snapshot that is already consistent, without
   * change tracking, re-keying scans or per-row lookups: the read model is
   * rebuilt on every sync generation, and the import path was quadratic in the
   * number of items (v5 3.6). Use `importFull` for anything that merges into
   * existing data.
   */
  loadSnapshot(s: FullSnapshot): void {
    s.fields.forEach((f, i) => this.fields.set(f.id, fieldRow(f, s.projectId, i)));
    for (const t of s.issueTypes) this.issueTypes.set(t.id, { name: t.name, color: t.color, description: t.description });
    for (const l of s.labels) this.labels.set(l.id, { name: l.name, color: l.color, description: l.description });
    for (const m of s.milestones) this.milestones.set(m.id, { number: m.number, title: m.title, state: m.state, dueOn: m.dueOn });
    for (const u of s.ghUsers) this.ghUsers.set(u.githubId, { login: u.login, avatarUrl: u.avatarUrl });
    for (const i of s.issues) {
      if (i.isPullRequest) continue;
      this.putIssue({
        nodeId: i.nodeId,
        number: i.number,
        title: i.title,
        body: i.body ?? null,
        state: i.state,
        stateReason: i.stateReason,
        typeId: i.typeId ?? null,
        milestoneId: i.milestoneId,
        parentNodeId: i.parentNodeId ?? null,
        authorLogin: i.authorLogin,
        url: i.url,
        createdAt: i.createdAt,
        updatedAt: i.updatedAt,
        closedAt: i.closedAt,
        labelIds: [...i.labelIds],
        assigneeIds: [...i.assigneeIds],
      });
    }
    // One item per issue, and only for issues in the model: what the database
    // already guarantees and the import path enforces.
    const itemOf = new Set<string>();
    for (const p of s.projectItems) {
      if (!this.issues.has(p.issueNodeId) || itemOf.has(p.issueNodeId)) continue;
      itemOf.add(p.issueNodeId);
      this.putItem({ ...p });
    }
    for (const pr of s.pullRequests ?? []) this.pullRequests.set(pr.nodeId, normalizePullRequest(pr));
    for (const t of s.teams ?? []) this.teams.set(t.slug, [...new Set(t.members.map((m) => m.toLowerCase()))].sort());
  }

  listFields() {
    return [...this.fields].map(([id, f]) => ({ id, name: f.name, dataType: f.dataType, options: f.options }));
  }

  /**
   * The field mapping the user confirmed (§4.1, lib/settings.ts), set when
   * the model is served. Null before there is one (tests, the dev preview):
   * the model then runs on the suggestion from its own fields.
   */
  mapping: FieldMapping | null = null;
  projectFieldMap(): FieldMapping {
    return effectiveMapping(this.mapping, this.listFields());
  }

  /** Mapped fields the project no longer has: "Missing field — remap" (§4.1). */
  missingFields(): MissingField[] {
    return missingFields(this.projectFieldMap(), this.listFields());
  }

  /** Issues by number, kept in step with `issues` (edits looked an issue up by scanning all of them). */
  private issueByNumberIdx = new Map<number, IssueRow>();
  protected putIssue(row: IssueRow) {
    const prev = this.issues.get(row.nodeId);
    if (prev && prev.number !== row.number && this.issueByNumberIdx.get(prev.number) === prev) this.issueByNumberIdx.delete(prev.number);
    this.issues.set(row.nodeId, row);
    this.issueByNumberIdx.set(row.number, row);
  }
  issueByNumber(n: number): IssueRow | undefined {
    return this.issueByNumberIdx.get(n);
  }

  /** Each issue's item, kept in step with `projectItems` (the fallback lookup was a scan per insert). */
  private itemByIssue = new Map<string, ItemRow>();
  protected putItem(item: ItemRow) {
    const prev = this.projectItems.get(item.itemId);
    if (prev && prev.issueNodeId !== item.issueNodeId && this.itemByIssue.get(prev.issueNodeId) === prev) this.itemByIssue.delete(prev.issueNodeId);
    this.projectItems.set(item.itemId, item);
    this.itemByIssue.set(item.issueNodeId, item);
  }
  protected dropItem(itemId: string) {
    const item = this.projectItems.get(itemId);
    if (item && this.itemByIssue.get(item.issueNodeId) === item) this.itemByIssue.delete(item.issueNodeId);
    this.projectItems.delete(itemId);
  }
  /** The issue's project item, if it has one. */
  itemForIssue(nodeId: string): ItemRow | undefined {
    return this.itemByIssue.get(nodeId);
  }
}
