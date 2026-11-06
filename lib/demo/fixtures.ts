// Small snapshot of the fictional `acme/widgets` repo and its "Widgets Roadmap"
// org project (SPEC §0.2). Every ID here is made up; tests/repo/node-ids.test.ts
// keeps real GitHub node IDs out of the repo. Used by the explicit demo store
// (DEMO_DATASET=fixtures) and tests.
import type { FullSnapshot, SnapshotProjectItem, SnapshotPullRequest } from "@/lib/sync/types";

/**
 * A project item as GitHub's scan reports it: the mapped Status, Priority and
 * Sprint values, and every single-select and iteration value by field ID in `dims`.
 */
export function projectItem(
  p: Pick<SnapshotProjectItem, "itemId" | "issueNodeId" | "statusOpt" | "priorityOpt" | "releaseIter">,
  fields: { status: string; priority: string; sprint?: string },
  extra: Record<string, string | null> = {},
): SnapshotProjectItem {
  const dims: Record<string, string> = {};
  if (p.statusOpt) dims[fields.status] = p.statusOpt;
  if (p.priorityOpt) dims[fields.priority] = p.priorityOpt;
  if (p.releaseIter && fields.sprint) dims[fields.sprint] = p.releaseIter;
  for (const [fieldId, opt] of Object.entries(extra)) if (opt) dims[fieldId] = opt;
  return { ...p, ...(Object.keys(dims).length ? { dims } : {}) };
}

const FIELDS = { status: "PVTSSF_acme_status", priority: "PVTSSF_acme_priority", sprint: "PVTIF_acme_release" };
const TEAM = "PVTSSF_acme_team";

const DAY = 86_400_000;
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * Release iterations are built relative to `now` so "Sprint 23" stays the current
 * one (and Sprint 22 the one right before it) whatever day the suite runs. The
 * titles and IDs are stable; the e2e specs assert on them.
 */
export function fixtureIterations(now = new Date()) {
  const today = Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
  const currentStart = today - 10 * DAY;
  return [
    { id: "e0000023", title: "Sprint 23", startDate: isoDay(currentStart), duration: 28 },
    { id: "e0000022", title: "Sprint 22", startDate: isoDay(currentStart - 35 * DAY), duration: 35 },
  ];
}

export function fixtureSnapshot(now = new Date()): FullSnapshot {
  return {
    projectId: "PVT_acme_widgets_roadmap",
    fields: [
      {
        id: "PVTSSF_acme_status",
        name: "Status",
        dataType: "SINGLE_SELECT",
        options: [
          { id: "a0000001", name: "📋 To do", color: "BLUE" },
          { id: "a0000002", name: "🚧 In progress", color: "PURPLE" },
          { id: "a0000006", name: "✅ Done", color: "GREEN" },
        ],
      },
      {
        id: "PVTSSF_acme_priority",
        name: "Priority",
        dataType: "SINGLE_SELECT",
        options: [
          { id: "b0000001", name: "Low", color: "BLUE" },
          { id: "b0000002", name: "Medium", color: "YELLOW" },
          { id: "b0000003", name: "High", color: "RED" },
        ],
      },
      {
        id: "PVTSSF_acme_team",
        name: "Team",
        dataType: "SINGLE_SELECT",
        options: [
          { id: "c0000001", name: "Core 🧱", color: "YELLOW" },
          { id: "c0000002", name: "Checkout 🛒", color: "PINK" },
        ],
      },
      {
        id: "PVTIF_acme_release",
        name: "Release",
        dataType: "ITERATION",
        iterations: fixtureIterations(now),
      },
    ],
    issueTypes: [
      { id: "IT_acme_task", name: "Task", color: "YELLOW", description: "A specific piece of work" },
      { id: "IT_acme_bug", name: "Bug", color: "RED", description: "An unexpected problem or behavior" },
      { id: "IT_acme_feature", name: "Feature", color: "BLUE", description: "A request, idea, or new functionality" },
    ],
    labels: [
      { id: "LA_1", name: "UI", color: "blue", description: "" },
      { id: "LA_2", name: "dashboard", color: "green", description: "" },
    ],
    milestones: [
      { id: "M_1", number: 12, title: "Sprint 23", state: "open", dueOn: null },
    ],
    ghUsers: [
      { githubId: "U_1", login: "alice", avatarUrl: null },
      { githubId: "U_2", login: "bob", avatarUrl: null },
    ],
    issues: [
      {
        nodeId: "I_epic",
        number: 100,
        title: "Epic: dashboard overhaul",
        body: "Parent epic",
        state: "open",
        stateReason: null,
        typeId: "IT_acme_feature",
        milestoneId: "M_1",
        parentNodeId: null,
        authorLogin: "alice",
        url: "https://github.com/acme/widgets/issues/100",
        createdAt: "2026-09-01T00:00:00Z",
        updatedAt: "2026-10-01T00:00:00Z",
        closedAt: null,
        labelIds: ["LA_1"],
        assigneeIds: ["U_1"],
      },
      {
        nodeId: "I_sub",
        number: 101,
        title: "Sub: dashboard widget",
        body: "Child",
        state: "open",
        stateReason: null,
        typeId: "IT_acme_task",
        milestoneId: null,
        parentNodeId: "I_epic",
        authorLogin: "bob",
        url: "https://github.com/acme/widgets/issues/101",
        createdAt: "2026-09-02T00:00:00Z",
        updatedAt: "2026-10-02T00:00:00Z",
        closedAt: null,
        labelIds: ["LA_2"],
        assigneeIds: [],
      },
      {
        nodeId: "I_bug",
        number: 102,
        title: "Bug: crash on start",
        body: "Crash",
        state: "open",
        stateReason: null,
        typeId: "IT_acme_bug",
        milestoneId: null,
        parentNodeId: null,
        authorLogin: "alice",
        url: "https://github.com/acme/widgets/issues/102",
        createdAt: "2026-09-03T00:00:00Z",
        updatedAt: "2026-10-03T00:00:00Z",
        closedAt: null,
        labelIds: [],
        assigneeIds: ["U_2"],
      },
      {
        nodeId: "I_pr",
        number: 103,
        title: "Fix crash",
        body: "",
        state: "open",
        stateReason: null,
        typeId: null,
        milestoneId: null,
        parentNodeId: null,
        authorLogin: "alice",
        url: "https://github.com/acme/widgets/pull/103",
        createdAt: "2026-09-04T00:00:00Z",
        updatedAt: "2026-10-04T00:00:00Z",
        closedAt: null,
        labelIds: [],
        assigneeIds: [],
        isPullRequest: true,
      },
    ],
    projectItems: [
      projectItem({ itemId: "PVTI_1", issueNodeId: "I_epic", statusOpt: "a0000001", priorityOpt: "b0000003", releaseIter: "e0000023" }, FIELDS, { [TEAM]: "c0000001" }),
      projectItem({ itemId: "PVTI_2", issueNodeId: "I_sub", statusOpt: "a0000002", priorityOpt: "b0000002", releaseIter: null }, FIELDS, { [TEAM]: "c0000001" }),
      projectItem({ itemId: "PVTI_3", issueNodeId: "I_bug", statusOpt: null, priorityOpt: null, releaseIter: null }, FIELDS),
    ],
    // PR lens (SPEC §13). #103 is also in `issues` as the REST change check
    // sees it (isPullRequest), and is excluded there.
    pullRequests: [
      pr({ nodeId: "I_pr", number: 103, title: "Fix crash", authorLogin: "alice", reviewRequests: [{ kind: "user", reviewer: "bob" }, { kind: "team", reviewer: "core" }], closingIssueNodeIds: ["I_bug"], checksState: "FAILURE", reviewDecision: "REVIEW_REQUIRED" }),
      pr({ nodeId: "PR_104", number: 104, title: "Dashboard widget", authorLogin: "bob", state: "merged", mergedAt: "2026-10-05T10:00:00Z", closedAt: "2026-10-05T10:00:00Z", reviews: [{ author: "alice", state: "APPROVED", submittedAt: "2026-10-05T09:00:00Z" }], closingIssueNodeIds: ["I_sub"], reviewDecision: "APPROVED", labelIds: ["LA_2"] }),
      pr({ nodeId: "PR_105", number: 105, title: "Draft: dashboard settings", authorLogin: "bob", isDraft: true, reviewRequests: [{ kind: "user", reviewer: "alice" }], checksState: "PENDING" }),
    ],
    teams: [{ slug: "core", members: ["alice"] }],
  };
}

/** A fixture PR with sensible defaults. */
function pr(p: Partial<SnapshotPullRequest> & Pick<SnapshotPullRequest, "nodeId" | "number" | "title" | "authorLogin">): SnapshotPullRequest {
  return {
    body: "",
    state: "open",
    isDraft: false,
    url: `https://github.com/acme/widgets/pull/${p.number}`,
    headRef: `fix/${p.number}`,
    baseRef: "develop",
    reviewDecision: null,
    checksState: "SUCCESS",
    milestoneId: null,
    additions: 42,
    deletions: 7,
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-06T00:00:00Z",
    closedAt: null,
    mergedAt: null,
    labelIds: [],
    assigneeIds: [],
    reviewRequests: [],
    reviews: [],
    closingIssueNodeIds: [],
    ...p,
  };
}
