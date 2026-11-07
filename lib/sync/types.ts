// GitHub snapshot shapes (what the API gives us) — framework-free.
export type SnapshotFieldOption = { id: string; name: string; color: string };
export type SnapshotIteration = {
  id: string;
  title: string;
  startDate: string;
  duration: number;
};
export type SnapshotField = {
  id: string;
  name: string;
  dataType: string;
  options?: SnapshotFieldOption[];
  iterations?: SnapshotIteration[];
};

export type SnapshotIssueType = {
  id: string;
  name: string;
  color: string;
  description: string;
};
export type SnapshotLabel = {
  id: string;
  name: string;
  color: string;
  description: string;
};
export type SnapshotMilestone = {
  id: string;
  number: number;
  title: string;
  state: string;
  dueOn: string | null;
};
/**
 * `typeId` and `parentNodeId` are optional because the REST change-check does
 * not carry them: `undefined` means "not in this payload, keep what we have",
 * while an explicit `null` means "GitHub says this is now empty". Incremental
 * payloads that sent `null` instead of omitting would silently wipe native
 * issue types and parent links on every poll.
 */
export type SnapshotIssue = {
  nodeId: string;
  number: number;
  title: string;
  /**
   * Absent in the app's read model (S5: bodies stay in Postgres and are read
   * per item); a write without it keeps the stored body.
   */
  body?: string | null;
  state: string;
  stateReason: string | null;
  typeId?: string | null;
  milestoneId: string | null;
  parentNodeId?: string | null;
  /**
   * GitHub's own `subIssuesSummary` (§4.4): direct children and how many are
   * completed. `undefined` = not in this payload, keep what we have; `null`
   * = GitHub reports no summary. `total = 0` means no children.
   */
  subTotal?: number | null;
  subCompleted?: number | null;
  authorLogin: string;
  url: string;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  labelIds: string[];
  assigneeIds: string[];
  /** The REST issues endpoint lists pull requests too; Deska skips them (D6). */
  isPullRequest?: boolean;
};
export type SnapshotProjectItem = {
  itemId: string;
  issueNodeId: string;
  /** The values of the fields mapped to Status, Priority and Sprint (§4.1). */
  statusOpt: string | null;
  priorityOpt: string | null;
  releaseIter: string | null;
  /**
   * Every single-select and iteration value on the item, by field ID: what
   * dimensions read, and what a remapped Status, Priority or Sprint is taken
   * from. Absent means none.
   */
  dims?: Record<string, string>;
  /** The item's last change on GitHub; picks the item to keep when one issue has two (S7). */
  updatedAt?: string | null;
};

export type FullSnapshot = {
  projectId: string;
  fields: SnapshotField[];
  issueTypes: SnapshotIssueType[];
  labels: SnapshotLabel[];
  milestones: SnapshotMilestone[];
  ghUsers: { githubId: string; login: string; avatarUrl: string | null }[];
  issues: SnapshotIssue[];
  projectItems: SnapshotProjectItem[];
};

/**
 * A snapshot carrying only some parts (a poll or a project scan). It has no
 * fields, so `projectId` is never written and needs no real value.
 */
export function partialSnapshot(parts: Partial<FullSnapshot>): FullSnapshot {
  return { projectId: "", fields: [], issueTypes: [], labels: [], milestones: [], ghUsers: [], issues: [], projectItems: [], ...parts };
}
