// Full read-only live snapshot for the initial import and DB restore
// (SPEC §3): discovered project metadata, issue types, labels, milestones,
// assignable users, the initial issue window (all open + closed in the last
// IMPORT_CLOSED_MONTHS), and every project item. No writes to GitHub.
import { restClient, gqlClient } from "../github/client";
import { githubTarget, type GithubTarget } from "../config";
import type { IdResolver } from "./poll";
import type { ReconcileSource } from "./reconcile";
import { effectiveMapping, type ProjectFieldMap } from "./field-map";
import { readMapping } from "../settings";
import { GitHubSource, ProjectNotFoundError } from "./source-github";
import type { ImportSource, IssuePage } from "./first-import";
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

/** A guard against a cursor that never ends; far above any real project. */
const MAX_META_PAGES = 40;

/** Metadata (fields, options, iterations, issue types) is discovered, never hardcoded. */
async function fetchMetadata(
  token: string,
  org: string,
  num: number,
): Promise<{ projectId: string; fields: SnapshotField[]; issueTypes: SnapshotIssueType[] }> {
  const gql = gqlClient(token);
  // Every page of fields: the result is imported as complete, so a field left
  // off a short first page would be marked missing (§4.1) and lose its values.
  let projectId = "";
  const fieldNodes: any[] = [];
  let after: string | null = null;
  for (let page = 0; page < MAX_META_PAGES; page++) {
    const fieldsRes: any = await gql(
      `query DeskaSyncFields($org:String!, $num:Int!, $after:String) { organization: repositoryOwner(login:$org) { ... on ProjectV2Owner { projectV2(number:$num) {
      id fields(first:50, after:$after) { pageInfo { hasNextPage endCursor } nodes {
        ... on ProjectV2Field { id name dataType }
        ... on ProjectV2SingleSelectField { id name dataType options { id name color } }
        ... on ProjectV2IterationField { id name dataType configuration { duration iterations { id title startDate duration } completedIterations { id title startDate duration } } }
      } } } } } }`,
      { org, num, after },
    );
    const project = fieldsRes?.organization?.projectV2;
    if (!project) throw new ProjectNotFoundError(org, num);
    projectId = project.id;
    fieldNodes.push(...project.fields.nodes);
    const info = project.fields.pageInfo;
    if (!info?.hasNextPage || !info.endCursor) break;
    after = info.endCursor;
  }
  return {
    projectId,
    fields: fieldNodes.map((f: any) => ({
      id: f.id,
      name: f.name,
      dataType: f.dataType,
      options: f.options,
      iterations: f.configuration
        ? [...(f.configuration.iterations ?? []), ...(f.configuration.completedIterations ?? [])]
        : undefined,
    })),
    issueTypes: await fetchIssueTypes(token, org),
  };
}

/** The org's issue types. */
async function fetchIssueTypes(token: string, org: string): Promise<SnapshotIssueType[]> {
  try {
    // Every page: an org can have more types than one page holds.
    const types: SnapshotIssueType[] = [];
    let after: string | null = null;
    for (let page = 0; page < MAX_META_PAGES; page++) {
      const res: any = await gqlClient(token)(
        `query DeskaSyncIssueTypes($org:String!, $after:String) { organization: repositoryOwner(login:$org) { ... on Organization { issueTypes(first:50, after:$after) { pageInfo { hasNextPage endCursor } nodes { id name color description } } } } }`,
        { org, after },
      );
      const conn = res?.organization?.issueTypes;
      types.push(...(conn?.nodes ?? []));
      if (!conn?.pageInfo?.hasNextPage || !conn.pageInfo.endCursor) break;
      after = conn.pageInfo.endCursor;
    }
    return types;
  } catch (e) {
    // Optional permission (§3.2): refused, Type shows as unavailable.
    const errors = (e as { errors?: { type?: string }[] } | null)?.errors;
    if (Array.isArray(errors) && errors.some((x) => x?.type === "FORBIDDEN" || x?.type === "NOT_FOUND")) return [];
    throw e;
  }
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
  target: GithubTarget = githubTarget(),
): Promise<Pick<FullSnapshot, "projectId" | "fields" | "issueTypes" | "labels" | "milestones">> {
  const rest = restClient(token);
  const { owner, repo, org, projectNumber: num } = target;
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

type GhUser = FullSnapshot["ghUsers"][number];

const restUser = (u: RestUser): GhUser | null => (u.id != null && u.login ? { githubId: String(u.id), login: u.login, avatarUrl: u.avatar_url ?? null } : null);

/**
 * One REST issue as a snapshot row, with REST IDs for labels, assignees and the
 * milestone (the IDs the metadata import stores). `parentNodeId` stays
 * undefined until `issueExtras` fills it in.
 */
function restIssue(i: RestIssue, typeIdByName: Map<string, string>): SnapshotIssue {
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
}

/** Native type and parent link (GraphQL), which REST doesn't carry. */
async function addExtras(source: GitHubSource, issues: SnapshotIssue[]): Promise<void> {
  const extras = await source.issueExtras(issues.map((i) => i.nodeId));
  for (const i of issues) {
    const e = extras.get(i.nodeId);
    i.parentNodeId = e ? e.parentNodeId : null;
    if (e) {
      i.typeId = e.typeId;
      i.subTotal = e.subTotal;
      i.subCompleted = e.subCompleted;
    }
  }
}

/**
 * The first import's view of GitHub (lib/sync/first-import.ts), read-only:
 * metadata, assignable users, issues one REST page at a time (oldest update
 * first, so a `since` checkpoint resumes it), and project item pages.
 */
export class GitHubImportSource implements ImportSource {
  private rest: ReturnType<typeof restClient>;
  private items: GitHubSource;
  private typeIdByName: Map<string, string> | null = null;

  constructor(
    private token: string,
    private target: GithubTarget,
    fields: ProjectFieldMap,
  ) {
    this.rest = restClient(token);
    // Issues are mapped here with REST IDs; the item scan needs only the field map.
    this.items = new GitHubSource(token, undefined, fields, target);
  }

  async fetchMetadata() {
    return fetchRepoMetadata(this.token, this.target);
  }

  async listAssignableUsers(): Promise<GhUser[]> {
    const rows = (await this.rest.paginate(this.rest.issues.listAssignees, { owner: this.target.owner, repo: this.target.repo, per_page: 100 })) as RestUser[];
    return rows.flatMap((u) => restUser(u) ?? []);
  }

  /** Issue types by name (REST names the type; the cache keys it by ID). */
  private async types(): Promise<Map<string, string>> {
    if (!this.typeIdByName) {
      const types = await fetchIssueTypes(this.token, this.target.org);
      this.typeIdByName = new Map(types.map((t) => [t.name, t.id]));
    }
    return this.typeIdByName;
  }

  async issuesPage(state: "open" | "closed", since: string | null, page: number): Promise<IssuePage> {
    const res = await this.rest.issues.listForRepo({
      owner: this.target.owner,
      repo: this.target.repo,
      state,
      sort: "updated",
      direction: "asc",
      per_page: 100,
      page,
      ...(since ? { since } : {}),
    });
    const raw = res.data as unknown as RestIssue[];
    const typeIdByName = await this.types();
    const issues: SnapshotIssue[] = [];
    const users = new Map<string, GhUser>();
    for (const i of raw) {
      // The issues endpoint lists pull requests too; Deska skips them (D6).
      if (i.pull_request) continue;
      issues.push(restIssue(i, typeIdByName));
      // Assignees who are no longer assignable still appear on issues.
      for (const a of i.assignees ?? []) {
        const u = restUser(a);
        if (u) users.set(u.githubId, u);
      }
    }
    await addExtras(this.items, issues);
    const maxUpdatedAt = raw.reduce<string | null>((m, i) => (i.updated_at && (!m || i.updated_at > m) ? i.updated_at : m), null);
    return { issues, users: [...users.values()], full: raw.length >= 100, maxUpdatedAt };
  }

  scanProjectItems(cursor: string | null) {
    return this.items.scanProjectItems(cursor);
  }
}

/**
 * Everything at once, for the maintainer's `pnpm sync:full --live` (env
 * target). The app imports with GitHubImportSource instead, page by page.
 */
export async function fetchLiveSnapshot(token: string): Promise<FullSnapshot> {
  const rest = restClient(token);
  const target = githubTarget();
  const { owner, repo } = target;
  const cutoff = importClosedCutoff();

  const { projectId, fields, issueTypes, labels, milestones } = await fetchRepoMetadata(token, target);
  const typeIdByName = new Map(issueTypes.map((t) => [t.name, t.id]));

  const userRows = (await rest.paginate(rest.issues.listAssignees, {
    owner,
    repo,
    per_page: 100,
  })) as RestUser[];
  const ghUsers = userRows.flatMap((u) => restUser(u) ?? []);

  // Initial import window: all open issues, plus closed issues updated since the
  // cutoff (a superset of closed-at cutoff, and bounded by updated_at so a huge
  // repo does not page through its entire history).
  const extraAssignees = new Map<string, GhUser>();
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
        for (const a of i.assignees ?? []) {
          const u = restUser(a);
          if (u) extraAssignees.set(u.githubId, u);
        }
        issues.push(restIssue(i, typeIdByName));
      }
    }
  }

  // GraphQL reports labels, assignees and milestones by name, login and
  // number; map them onto the IDs this snapshot uses (REST IDs, as for issues).
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
    target,
  );

  // REST carries neither the parent link nor the type ID. Without this the
  // initial import stored no sub-issue relationships at all.
  await addExtras(source, issues);

  // Assignees who are no longer assignable (ex-members, outside collaborators)
  // still appear on issues; without a user row they rendered as numeric IDs.
  // Add them to the login -> ID map too: an assignee who is not in
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

  return {
    projectId,
    fields,
    issueTypes,
    labels,
    milestones,
    ghUsers,
    issues,
    projectItems,
  };
}

/** The nightly reconcile's view of GitHub (S6). Read-only. */
export function githubReconcileSource(token: string, ids: IdResolver, fields: ProjectFieldMap, target: GithubTarget = githubTarget()): ReconcileSource {
  const gh = new GitHubSource(token, ids, fields, target);
  return {
    fetchMetadata: () => fetchRepoMetadata(token, target),
    listOpenNodeIds: () => gh.listOpenNodeIds(),
    fetchNodes: (nodeIds) => gh.fetchNodes(nodeIds),
    // §4.4 [D9]: without this the reconcile never re-reads the parents' counts.
    fetchSubSummaries: (nodeIds) => gh.fetchSubSummaries(nodeIds),
    repoName: gh.repoName,
  };
}
