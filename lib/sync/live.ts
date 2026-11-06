// Full read-only live snapshot for the initial import and DB restore
// (SPEC §3): discovered project metadata, issue types, labels, milestones,
// assignable users, the initial issue window (all open + closed in the last
// IMPORT_CLOSED_MONTHS), and every project item. No writes to GitHub.
import { restClient, gqlClient } from "../github/client";
import { githubRepo, githubTarget } from "../config";
import type { IdResolver } from "./poll";
import type { ReconcileSource } from "./reconcile";
import { effectiveMapping, type ProjectFieldMap } from "./field-map";
import { readMapping } from "../settings";
import { GitHubSource } from "./source-github";
import type {
  FullSnapshot,
  SnapshotField,
  SnapshotIssue,
  SnapshotIssueType,
  SnapshotLabel,
  SnapshotMilestone,
} from "./types";

type RestLabel = { id?: number; name?: string; color?: string; description?: string | null };
type RestMilestone = {
  number: number;
  title?: string;
  state?: string;
  due_on?: string | null;
};
type RestUser = { id?: number; login?: string; avatar_url?: string | null };
type RestIssue = {
  node_id: string;
  number: number;
  title: string;
  body?: string | null;
  state: string;
  state_reason?: string | null;
  user?: { login?: string } | null;
  html_url: string;
  created_at: string;
  updated_at: string;
  closed_at?: string | null;
  labels?: RestLabel[];
  assignees?: RestUser[] | null;
  milestone?: RestMilestone | null;
  type?: { name?: string } | null;
  pull_request?: unknown;
};

/** Metadata (fields, options, iterations, issue types) is discovered, never hardcoded. */
async function fetchMetadata(
  token: string,
  org: string,
  num: number,
): Promise<{ projectId: string; fields: SnapshotField[]; issueTypes: SnapshotIssueType[] }> {
  const gql = gqlClient(token);
  const fieldsRes = await gql(
    `query($org:String!, $num:Int!) { organization(login:$org) { projectV2(number:$num) {
      id fields(first:40) { nodes {
        ... on ProjectV2Field { id name dataType }
        ... on ProjectV2SingleSelectField { id name dataType options { id name color } }
        ... on ProjectV2IterationField { id name dataType configuration { duration iterations { id title startDate duration } completedIterations { id title startDate duration } } }
      } } } } }`,
    { org, num },
  );
  const typesRes = await gql(
    `query($org:String!) { organization(login:$org) { issueTypes(first:20) { nodes { id name color description } } } }`,
    { org },
  );
  const fieldNodes = fieldsRes.organization.projectV2.fields.nodes;
  return {
    projectId: fieldsRes.organization.projectV2.id,
    fields: fieldNodes.map((f: any) => ({
      id: f.id,
      name: f.name,
      dataType: f.dataType,
      options: f.options,
      iterations: f.configuration
        ? [...(f.configuration.iterations ?? []), ...(f.configuration.completedIterations ?? [])]
        : undefined,
    })),
    issueTypes: typesRes.organization.issueTypes.nodes,
  };
}

/** Closed issues older than this stay out of the import and age out (S6). */
export function importClosedCutoff(now = Date.now()): string {
  const months = Number(process.env.IMPORT_CLOSED_MONTHS ?? 3);
  return new Date(now - months * 30 * 24 * 3600 * 1000).toISOString();
}

/**
 * Project fields (with options and iterations), issue types, labels and
 * milestones: the metadata the initial import and the nightly reconcile load.
 */
export async function fetchRepoMetadata(
  token: string,
): Promise<Pick<FullSnapshot, "projectId" | "fields" | "issueTypes" | "labels" | "milestones">> {
  const rest = restClient(token);
  const { owner, repo, org, projectNumber: num } = githubTarget();
  const { projectId, fields, issueTypes } = await fetchMetadata(token, org, num);

  const labelRows = (await rest.paginate(rest.issues.listLabelsForRepo, {
    owner,
    repo,
    per_page: 100,
  })) as RestLabel[];
  const labels: SnapshotLabel[] = labelRows.map((l) => ({
    id: String(l.id),
    name: l.name ?? "",
    color: l.color ?? "",
    description: l.description ?? "",
  }));

  const milestoneRows = (await rest.paginate(rest.issues.listMilestones, {
    owner,
    repo,
    state: "all",
    per_page: 100,
  })) as RestMilestone[];
  const milestones: SnapshotMilestone[] = milestoneRows.map((m) => ({
    id: String(m.number),
    number: m.number,
    title: m.title ?? "",
    state: m.state ?? "open",
    dueOn: m.due_on ?? null,
  }));
  return { projectId, fields, issueTypes, labels, milestones };
}

export async function fetchLiveSnapshot(token: string): Promise<FullSnapshot> {
  const rest = restClient(token);
  const { owner, repo } = githubRepo();
  const cutoff = importClosedCutoff();

  const { projectId, fields, issueTypes, labels, milestones } = await fetchRepoMetadata(token);
  const typeIdByName = new Map(issueTypes.map((t) => [t.name, t.id]));

  const userRows = (await rest.paginate(rest.issues.listAssignees, {
    owner,
    repo,
    per_page: 100,
  })) as RestUser[];
  const ghUsers = userRows.map((u) => ({
    githubId: String(u.id),
    login: u.login ?? "",
    avatarUrl: u.avatar_url ?? null,
  }));

  // Initial import window: all open issues, plus closed issues updated since the
  // cutoff (a superset of closed-at cutoff, and bounded by updated_at so a huge
  // repo does not page through its entire history).
  const extraAssignees = new Map<string, { githubId: string; login: string; avatarUrl: string | null }>();
  const toSnapshot = (i: RestIssue): SnapshotIssue => {
    for (const a of i.assignees ?? []) {
      if (a.id != null && a.login) {
        extraAssignees.set(String(a.id), { githubId: String(a.id), login: a.login, avatarUrl: a.avatar_url ?? null });
      }
    }
    return {
    nodeId: i.node_id,
    number: i.number,
    title: i.title,
    body: i.body ?? null,
    state: i.state,
    stateReason: i.state_reason ?? null,
    typeId: i.type?.name ? (typeIdByName.get(i.type.name) ?? null) : null,
    milestoneId: i.milestone ? String(i.milestone.number) : null,
    parentNodeId: undefined,
    authorLogin: i.user?.login ?? "unknown",
    url: i.html_url,
    createdAt: i.created_at,
    updatedAt: i.updated_at,
    closedAt: i.closed_at ?? null,
    labelIds: (i.labels ?? []).map((l) => String(typeof l === "string" ? l : l.id)),
    // A missing REST id becomes the string "undefined" and can never match a login.
    assigneeIds: (i.assignees ?? []).flatMap((a) => (a.id != null ? [String(a.id)] : [])),
    };
  };

  const issues: SnapshotIssue[] = [];
  const seen = new Set<string>();
  for (const state of ["open", "closed"] as const) {
    const pages = rest.paginate.iterator(rest.issues.listForRepo, {
      owner,
      repo,
      state,
      sort: "updated",
      direction: "desc",
      per_page: 100,
      ...(state === "closed" ? { since: cutoff } : {}),
    } as Parameters<typeof rest.issues.listForRepo>[0]);
    for await (const page of pages) {
      for (const i of page.data as RestIssue[]) {
        if (i.pull_request || seen.has(i.node_id)) continue;
        seen.add(i.node_id);
        issues.push(toSnapshot(i));
      }
    }
  }

  // PRs report labels, assignees and milestones by name, login and number;
  // map them onto the IDs this snapshot uses (REST IDs, as for issues).
  const labelIdByName = new Map(labels.map((l) => [l.name.toLowerCase(), l.id]));
  const userIdByLogin = new Map(ghUsers.map((u) => [u.login.toLowerCase(), u.githubId]));
  const source = new GitHubSource(
    token,
    {
      labelId: (name) => labelIdByName.get(name.toLowerCase()) ?? name,
      userId: (login) => userIdByLogin.get(login.toLowerCase()) ?? login,
      milestoneId: (n) => (milestones.some((m) => m.number === n) ? String(n) : null),
    },
    // The confirmed mapping (by field ID), or the suggestion from the fields
    // just discovered: never a literal (AGENTS).
    effectiveMapping(await readMapping(), fields),
  );

  // REST carries neither the parent link nor the type ID. Without this the
  // initial import stored no sub-issue relationships at all.
  const extras = await source.issueExtras(issues.map((i) => i.nodeId));
  for (const i of issues) {
    const e = extras.get(i.nodeId);
    i.parentNodeId = e ? e.parentNodeId : null;
    if (e) i.typeId = e.typeId;
  }

  // Assignees who are no longer assignable (ex-members, outside collaborators)
  // still appear on issues; without a user row they rendered as numeric IDs.
  // Add them to the login -> ID map too: a PR assignee who is not in
  // `listAssignees` must resolve to their githubId, not be keyed by login (F9).
  const knownUsers = new Set(ghUsers.map((u) => u.githubId));
  for (const u of extraAssignees.values()) {
    if (!knownUsers.has(u.githubId)) {
      ghUsers.push(u);
      userIdByLogin.set(u.login.toLowerCase(), u.githubId);
    }
  }

  // Only project items whose issue we imported; the project may hold other
  // repos' items, which Deska ignores (and which would otherwise fail the link).
  const projectItems = (await source.scanAllProjectItems()).filter((p) =>
    seen.has(p.issueNodeId),
  );

  // PRs (SPEC §13.1): every open one, plus those closed or merged within the
  // same window as issues; then the members of teams asked to review.
  const cutoffIso = new Date(cutoff).toISOString();
  const pullRequests = [
    ...(await source.listPullRequests(["OPEN"])),
    ...(await source.listPullRequests(["CLOSED", "MERGED"], cutoffIso)),
  ];
  const teams = await source.teamMembers(pullRequests.flatMap((p) => p.reviewRequests.filter((r) => r.kind === "team").map((r) => r.reviewer)));

  return {
    projectId,
    fields,
    issueTypes,
    labels,
    milestones,
    ghUsers,
    issues,
    projectItems,
    pullRequests,
    teams,
  };
}

/** The nightly reconcile's view of GitHub (S6). Read-only. */
export function githubReconcileSource(token: string, ids: IdResolver, fields: ProjectFieldMap): ReconcileSource {
  const gh = new GitHubSource(token, ids, fields);
  return {
    fetchMetadata: () => fetchRepoMetadata(token),
    listOpenNodeIds: () => gh.listOpenNodeIds(),
    fetchNodes: (nodeIds) => gh.fetchNodes(nodeIds),
    repoName: gh.repoName,
  };
}
