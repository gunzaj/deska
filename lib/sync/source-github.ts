// Live read-only SyncSource: REST issue change check (ETag/304) +
// periodic project item scan. No writes to GitHub.
import { gqlClient, restClient } from "../github/client";
import { githubTarget } from "../config";
import type { LogicalField, ProjectFieldMap } from "./field-map";
import type { SnapshotIssue, SnapshotProjectItem, SnapshotPullRequest, SnapshotTeam } from "./types";
import type { ChangeCheck, IdResolver, SyncSource } from "./poll";

type RestLabel = { name?: string; id?: number } | string;
type RestMilestone = { number: number; title?: string } | null;

/** The §13.1 PR fields (P0 measured one page of 100 at 6 points). */
const PR_FIELDS = `
  id number title body state isDraft mergedAt closedAt createdAt updatedAt url
  author { login } headRefName baseRefName reviewDecision additions deletions
  milestone { number }
  assignees(first:10) { nodes { login } }
  labels(first:20) { nodes { name } }
  reviewRequests(first:20) { nodes { requestedReviewer { __typename ... on User { login } ... on Team { slug } } } }
  latestReviews(first:20) { nodes { author { login } state submittedAt } }
  commits(last:1) { nodes { commit { statusCheckRollup { state } } } }
  closingIssuesReferences(first:10) { nodes { id repository { nameWithOwner } } }
`;

type GqlPr = {
  id: string;
  number: number;
  title: string;
  body: string | null;
  state: "OPEN" | "CLOSED" | "MERGED";
  isDraft: boolean;
  mergedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
  url: string;
  author: { login: string } | null;
  headRefName: string;
  baseRefName: string;
  reviewDecision: string | null;
  additions: number;
  deletions: number;
  milestone: { number: number } | null;
  assignees: { nodes: { login: string }[] };
  labels: { nodes: { name: string }[] };
  reviewRequests: { nodes: { requestedReviewer: { __typename: string; login?: string; slug?: string } | null }[] };
  latestReviews: { nodes: { author: { login: string } | null; state: string; submittedAt: string | null }[] };
  commits: { nodes: { commit: { statusCheckRollup: { state: string } | null } }[] };
  closingIssuesReferences: { nodes: { id: string; repository: { nameWithOwner: string } }[] };
};

type GqlIssueNode = {
  __typename: "Issue";
  id: string;
  number: number;
  title: string;
  body: string | null;
  state: string;
  stateReason: string | null;
  url: string;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  author: { login: string } | null;
  issueType: { id: string } | null;
  parent: { id: string } | null;
  milestone: { number: number } | null;
  labels: { nodes: { name: string }[] };
  assignees: { nodes: { login: string }[] };
  repository: { nameWithOwner: string };
};
type GqlNode = (GqlIssueNode | (GqlPr & { __typename: "PullRequest" })) & { repository?: { nameWithOwner: string } };

/** An issue or PR fetched by node ID, with the repository it lives in now. */
export type FetchedNode =
  | { kind: "issue"; repo: string; issue: SnapshotIssue }
  | { kind: "pr"; repo: string; pr: SnapshotPullRequest };

type GqlItemConnection = {
  totalCount: number;
  pageInfo: { hasNextPage: boolean; endCursor: string };
  nodes: {
    id: string;
    updatedAt?: string;
    content: { id?: string } | null;
    fieldValues: { nodes: ({ optionId?: string; iterationId?: string; field?: { id?: string; name?: string } } | null)[] };
  }[];
};

export class GitHubSource implements SyncSource {
  private rest: ReturnType<typeof restClient>;
  private gql: ReturnType<typeof gqlClient>;
  private owner: string;
  private repo: string;
  private org: string;
  private projectNumber: number;
  /**
   * REST reports labels/milestones/assignees by name or login, never by the
   * node IDs our store keys on. Without this resolver an incremental poll
   * cannot express those fields and would have to blank them out.
   */
  private ids?: IdResolver;
  /** The logical -> discovered-field (by ID) mapping (AGENTS: never hardcode). */
  private fields: ProjectFieldMap;

  /** No default map: a source built without one is a type error (v5 1.3). */
  constructor(token: string, ids: IdResolver | undefined, fields: ProjectFieldMap) {
    this.rest = restClient(token);
    this.gql = gqlClient(token);
    const target = githubTarget();
    this.owner = target.owner;
    this.repo = target.repo;
    this.org = target.org;
    this.projectNumber = target.projectNumber;
    this.ids = ids;
    this.fields = fields;
  }

  /** Swap in the map a sync cycle just refreshed (a long-lived worker keeps one source). */
  useFields(fields: ProjectFieldMap): void {
    this.fields = fields;
  }

  async checkChanges(since: string | null, etag: string | null): Promise<ChangeCheck> {
    try {
      // Paginate: a busy window easily exceeds one 100-item page, and the old
      // single-page read silently dropped the overflow while still advancing
      // the cursor past it. The first page's ETag is captured so an unchanged
      // window costs a free 304 next time; previously the stored ETag was
      // always the one we sent (initially empty), so GitHub never returned 304.
      //
      // The If-None-Match header goes on the first page only: a 304 on a later
      // page would make paginate throw and silently report "not modified".
      const base = { owner: this.owner, repo: this.repo, state: "all" as const, sort: "updated" as const, per_page: 100, ...(since ? { since } : {}) };
      const first = await this.rest.issues.listForRepo({ ...base, ...(etag ? { headers: { "If-None-Match": etag } } : {}) });
      const newEtag = String(first.headers.etag ?? "");
      const raw = [...first.data];
      if (first.data.length === 100) {
        const page2 = { ...base, page: 2 } as Parameters<typeof this.rest.issues.listForRepo>[0];
        raw.push(...(await this.rest.paginate(this.rest.issues.listForRepo, page2, (response) => response.data)));
      }

      const issues: SnapshotIssue[] = [];
      const prNodeIds: string[] = [];
      for (const i of raw) {
        // The issues endpoint also lists PRs (P0): fetch those in full below.
        if (i.pull_request) {
          prNodeIds.push(i.node_id);
          continue;
        }
        issues.push(await this.toSnapshotIssue(i));
      }
      const pullRequests = await this.fetchPullRequests(prNodeIds);
      // REST has no parent link and only the type name; fetch both by node ID
      // so new issues arrive with their epic and type instead of waiting for a
      // full reconcile.
      const extra = await this.issueExtras(issues.map((i) => i.nodeId));
      for (const i of issues) {
        const e = extra.get(i.nodeId);
        if (e) {
          i.typeId = e.typeId;
          i.parentNodeId = e.parentNodeId;
        }
      }
      const maxUpdated = raw.reduce<string>(
        (m, i) => (i.updated_at && i.updated_at > m ? i.updated_at : m),
        "",
      );
      return {
        kind: "changed",
        issues,
        items: [],
        pullRequests,
        etag: newEtag ?? etag ?? "",
        // `since` is inclusive on updated_at. Advancing to the newest row we
        // actually processed never skips an issue: issues sharing that second are
        // re-read next time (idempotent). REST `since` has no tie-breaker, so a
        // batch edit re-reads its batch once rather than risk dropping one
        // (IMPROVEMENTS-2 F10, decided: keep the safe re-read).
        since: maxUpdated || since || new Date().toISOString(),
      };
    } catch (e) {
      if (errorStatus(e) === 304) return { kind: "not-modified" };
      if (isRateLimitError(e)) {
        return { kind: "rate-limited", retryAfterMs: retryAfterMs(e) };
      }
      throw e;
    }
  }

  /**
   * Native issue type and parent link for a batch of issues (GraphQL, 100 per
   * request, ~1 point each). Issues GitHub no longer resolves are skipped.
   */
  async issueExtras(
    nodeIds: string[],
  ): Promise<Map<string, { typeId: string | null; parentNodeId: string | null }>> {
    const out = new Map<string, { typeId: string | null; parentNodeId: string | null }>();
    for (let i = 0; i < nodeIds.length; i += 100) {
      const ids = nodeIds.slice(i, i + 100);
      const res = await this.gql(
        `query($ids:[ID!]!) { nodes(ids:$ids) { ... on Issue { id issueType { id } parent { id } } } }`,
        { ids },
      );
      for (const n of (res?.nodes ?? []) as ({ id?: string; issueType?: { id: string } | null; parent?: { id: string } | null } | null)[]) {
        if (!n?.id) continue;
        out.set(n.id, { typeId: n.issueType?.id ?? null, parentNodeId: n.parent?.id ?? null });
      }
    }
    return out;
  }

  /**
   * Map one REST issue. `typeId`/`parentNodeId` are deliberately omitted: the
   * REST change-check has no such data, and sending null would erase the
   * native issue type and detach sub-issues on every single poll.
   */
  private async toSnapshotIssue(i: {
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
    assignees?: { login?: string }[] | null;
    milestone?: RestMilestone | undefined;
  }): Promise<SnapshotIssue> {
    const ids = this.ids;
    const labelIds: string[] = [];
    for (const l of i.labels ?? []) {
      const name = typeof l === "string" ? l : l.name;
      if (name && ids) labelIds.push(await ids.labelId(name));
    }
    const assigneeIds: string[] = [];
    for (const a of i.assignees ?? []) {
      if (a.login && ids) assigneeIds.push(await ids.userId(a.login));
    }
    return {
      nodeId: i.node_id,
      number: i.number,
      title: i.title,
      body: i.body ?? null,
      state: i.state,
      stateReason: i.state_reason ?? null,
      milestoneId: await this.milestoneId(i.milestone),
      authorLogin: i.user?.login ?? "unknown",
      url: i.html_url,
      createdAt: i.created_at,
      updatedAt: i.updated_at,
      closedAt: i.closed_at ?? null,
      labelIds,
      assigneeIds,
    };
  }

  private async milestoneId(m: RestMilestone | undefined): Promise<string | null> {
    if (!m || !this.ids) return null;
    return this.ids.milestoneId(m.number);
  }

  /** Map one GraphQL PR onto the snapshot, resolving names to store IDs. */
  private async toSnapshotPr(p: GqlPr): Promise<SnapshotPullRequest> {
    const ids = this.ids;
    const labelIds: string[] = [];
    const assigneeIds: string[] = [];
    if (ids) {
      for (const l of p.labels.nodes) labelIds.push(await ids.labelId(l.name));
      for (const a of p.assignees.nodes) assigneeIds.push(await ids.userId(a.login));
    }
    const repo = `${this.owner}/${this.repo}`;
    return {
      nodeId: p.id,
      number: p.number,
      title: p.title,
      body: p.body,
      state: p.state === "MERGED" ? "merged" : p.state === "CLOSED" ? "closed" : "open",
      isDraft: p.isDraft,
      authorLogin: p.author?.login ?? "ghost",
      url: p.url,
      headRef: p.headRefName,
      baseRef: p.baseRefName,
      reviewDecision: p.reviewDecision,
      checksState: p.commits.nodes[0]?.commit.statusCheckRollup?.state ?? null,
      milestoneId: p.milestone && ids ? await ids.milestoneId(p.milestone.number) : null,
      additions: p.additions,
      deletions: p.deletions,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      closedAt: p.closedAt,
      mergedAt: p.mergedAt,
      labelIds,
      assigneeIds,
      reviewRequests: p.reviewRequests.nodes
        .map((n) => n.requestedReviewer)
        .flatMap((r): SnapshotPullRequest["reviewRequests"] =>
          r?.__typename === "User" && r.login ? [{ kind: "user", reviewer: r.login.toLowerCase() }] : r?.__typename === "Team" && r.slug ? [{ kind: "team", reviewer: r.slug }] : [],
        ),
      reviews: p.latestReviews.nodes.filter((r) => r.author).map((r) => ({ author: r.author!.login.toLowerCase(), state: r.state, submittedAt: r.submittedAt })),
      // Only this repo's issues: the cache holds nothing else.
      closingIssueNodeIds: p.closingIssuesReferences.nodes.filter((n) => n.repository.nameWithOwner === repo).map((n) => n.id),
    };
  }

  /** Full PR data for these node IDs (from the REST change check), 50 per request. */
  async fetchPullRequests(nodeIds: string[]): Promise<SnapshotPullRequest[]> {
    const out: SnapshotPullRequest[] = [];
    for (let i = 0; i < nodeIds.length; i += 50) {
      const res = await this.gql(`query($ids:[ID!]!) { nodes(ids:$ids) { ... on PullRequest { ${PR_FIELDS} } } }`, { ids: nodeIds.slice(i, i + 50) });
      for (const n of (res?.nodes ?? []) as (GqlPr | null)[]) if (n?.id) out.push(await this.toSnapshotPr(n));
    }
    return out;
  }

  /**
   * Walk PRs newest-updated first. Open PRs: all of them. Closed/merged:
   * until they were last updated before `since` (closed before it, too).
   */
  async listPullRequests(states: ("OPEN" | "CLOSED" | "MERGED")[], since?: string): Promise<SnapshotPullRequest[]> {
    const out: SnapshotPullRequest[] = [];
    let after: string | null = null;
    for (;;) {
      const res: { repository: { pullRequests: { pageInfo: { hasNextPage: boolean; endCursor: string }; nodes: GqlPr[] } } } = await this.gql(
        `query($owner:String!, $name:String!, $after:String, $states:[PullRequestState!]) {
          repository(owner:$owner, name:$name) {
            pullRequests(first:100, after:$after, states:$states, orderBy:{field:UPDATED_AT, direction:DESC}) {
              pageInfo { hasNextPage endCursor } nodes { ${PR_FIELDS} }
            }
          }
        }`,
        { owner: this.owner, name: this.repo, after, states },
      );
      const conn = res.repository.pullRequests;
      for (const n of conn.nodes) {
        if (since && n.updatedAt < since) return out;
        out.push(await this.toSnapshotPr(n));
      }
      if (!conn.pageInfo.hasNextPage) return out;
      after = conn.pageInfo.endCursor;
    }
  }

  /**
   * Node IDs of every open issue and open PR in the repo, IDs only (S6
   * reconcile). One point per page of 100.
   */
  async listOpenNodeIds(): Promise<{ issues: string[]; pullRequests: string[] }> {
    const out = { issues: [] as string[], pullRequests: [] as string[] };
    for (const kind of ["issues", "pullRequests"] as const) {
      let after: string | null = null;
      for (;;) {
        const res: { repository: Record<typeof kind, { pageInfo: { hasNextPage: boolean; endCursor: string }; nodes: { id: string }[] }> } = await this.gql(
          `query($owner:String!, $name:String!, $after:String) {
            repository(owner:$owner, name:$name) {
              ${kind}(first:100, after:$after, states:[OPEN]) { pageInfo { hasNextPage endCursor } nodes { id } }
            }
          }`,
          { owner: this.owner, name: this.repo, after },
        );
        const conn = res.repository[kind];
        out[kind].push(...conn.nodes.map((n) => n.id));
        if (!conn.pageInfo.hasNextPage) break;
        after = conn.pageInfo.endCursor;
      }
    }
    return out;
  }

  /**
   * Issues and PRs by node ID, wherever they live now (S6 reconcile). A node
   * GitHub can't resolve (deleted) maps to null; `repo` tells a transferred
   * issue from one still in this repo.
   */
  async fetchNodes(nodeIds: string[]): Promise<Map<string, FetchedNode | null>> {
    const out = new Map<string, FetchedNode | null>();
    const ids = this.ids;
    for (let i = 0; i < nodeIds.length; i += 50) {
      const batch = nodeIds.slice(i, i + 50);
      let res: { nodes?: (GqlNode | null)[] } | null;
      try {
        res = await this.gql(
          `query($ids:[ID!]!) { nodes(ids:$ids) {
            ... on Issue { __typename id number title body state stateReason url createdAt updatedAt closedAt
              author { login } issueType { id } parent { id } milestone { number }
              labels(first:50) { nodes { name } } assignees(first:20) { nodes { login } }
              repository { nameWithOwner } }
            ... on PullRequest { __typename ${PR_FIELDS} repository { nameWithOwner } }
          } }`,
          { ids: batch },
        );
      } catch (e) {
        // A deleted node makes GitHub answer with partial data plus a
        // NOT_FOUND error, which the client throws; the data is still there.
        // Only NOT_FOUND is tolerated: a 5xx or permission error that happens
        // to carry stale data must not be imported as authoritative.
        const partial = (e as { data?: { nodes?: (GqlNode | null)[] } } | null)?.data;
        if (!partial?.nodes || isRateLimitError(e) || !isNotFoundError(e)) throw e;
        res = partial;
      }
      const nodes = res?.nodes ?? [];
      // Index by node ID, not array position: a reordered or truncated response
      // must never map a live node onto the wrong requested ID (or a false null).
      const byId = new Map<string, GqlNode>();
      for (const n of nodes) if (n?.id) byId.set(n.id, n);
      for (const id of batch) {
        const n = byId.get(id);
        if (!n?.id) {
          out.set(id, null);
          continue;
        }
        const repo = n.repository?.nameWithOwner ?? "";
        if (n.__typename === "PullRequest") {
          out.set(id, { kind: "pr", repo, pr: await this.toSnapshotPr(n as unknown as GqlPr) });
          continue;
        }
        const issue = n as GqlIssueNode;
        const labelIds: string[] = [];
        const assigneeIds: string[] = [];
        if (ids) {
          for (const l of issue.labels.nodes) labelIds.push(await ids.labelId(l.name));
          for (const a of issue.assignees.nodes) assigneeIds.push(await ids.userId(a.login));
        }
        out.set(id, {
          kind: "issue",
          repo,
          issue: {
            nodeId: issue.id,
            number: issue.number,
            title: issue.title,
            body: issue.body,
            state: issue.state.toLowerCase(),
            stateReason: issue.stateReason ? issue.stateReason.toLowerCase() : null,
            typeId: issue.issueType?.id ?? null,
            parentNodeId: issue.parent?.id ?? null,
            milestoneId: issue.milestone && ids ? await ids.milestoneId(issue.milestone.number) : null,
            authorLogin: issue.author?.login ?? "ghost",
            url: issue.url,
            createdAt: issue.createdAt,
            updatedAt: issue.updatedAt,
            closedAt: issue.closedAt,
            labelIds,
            assigneeIds,
          },
        });
      }
    }
    return out;
  }

  /** This source's repository as `owner/name`. */
  get repoName(): string {
    return `${this.owner}/${this.repo}`;
  }

  /** Every open PR: the periodic rescan for review requests and CI (P0 (e)). */
  async scanOpenPullRequests(): Promise<SnapshotPullRequest[]> {
    return this.listPullRequests(["OPEN"]);
  }

  /**
   * Members of the teams asked to review, for "review requested from me".
   * Needs `read:org`; a token without it yields nothing rather than failing.
   */
  async teamMembers(slugs: string[]): Promise<SnapshotTeam[]> {
    const out: SnapshotTeam[] = [];
    for (const slug of [...new Set(slugs)]) {
      try {
        const members: string[] = [];
        let after: string | null = null;
        for (;;) {
          const res: { organization: { team: { members: { pageInfo: { hasNextPage: boolean; endCursor: string }; nodes: { login: string }[] } } | null } } = await this.gql(
            `query($org:String!, $slug:String!, $after:String) { organization(login:$org) { team(slug:$slug) {
              members(first:100, after:$after) { pageInfo { hasNextPage endCursor } nodes { login } } } } }`,
            { org: this.org, slug, after },
          );
          const team = res.organization.team;
          if (!team) break;
          members.push(...team.members.nodes.map((m) => m.login.toLowerCase()));
          if (!team.members.pageInfo.hasNextPage) break;
          after = team.members.pageInfo.endCursor;
        }
        out.push({ slug, members });
      } catch (e) {
        // A rate limit or a transient failure must surface so the scan can back
        // off; only "no read:org" (a 4xx permission error) is tolerated, and
        // team requests just won't match anyone.
        if (isRateLimitError(e) || (errorStatus(e) ?? 0) >= 500) throw e;
      }
    }
    return out;
  }

  /**
   * One page of project items (100) with mapped field values. `fieldValues`
   * asks for 50: a project can have many fields, and a value past the page end
   * would read as "cleared" and wipe that field in the cache.
   */
  async scanProjectItems(cursor: string | null): Promise<{ items: SnapshotProjectItem[]; nextCursor: string | null; total: number }> {
    const res = await this.gql(
      `query($org:String!, $num:Int!, $after:String) {
        organization(login:$org) { projectV2(number:$num) {
          items(first:100, after:$after) {
            totalCount
            pageInfo { hasNextPage endCursor }
            nodes { id updatedAt content { ... on Issue { id } }
              fieldValues(first:50) { nodes {
                ... on ProjectV2ItemFieldSingleSelectValue { optionId field { ... on ProjectV2FieldCommon { id name } } }
                ... on ProjectV2ItemFieldIterationValue { iterationId field { ... on ProjectV2FieldCommon { id name } } }
              } }
          }
        } }
      } }`,
      { org: this.org, num: this.projectNumber, after: cursor },
    );
    const conn: GqlItemConnection = res.organization.projectV2.items;
    const items: SnapshotProjectItem[] = conn.nodes.flatMap((n) => {
      const issueNodeId = n.content?.id;
      if (!issueNodeId) return [];
      const row: SnapshotProjectItem = {
        itemId: n.id,
        updatedAt: n.updatedAt ?? null,
        issueNodeId,
        statusOpt: null,
        priorityOpt: null,
        teamOpt: null,
        platformOpt: null,
        releaseIter: null,
      };
      applyFieldValues(row, n.fieldValues.nodes, this.fields);
      return [row];
    });
    return {
      items,
      nextCursor: conn.pageInfo.hasNextPage ? conn.pageInfo.endCursor : null,
      total: conn.totalCount,
    };
  }

  /**
   * The issue's project item with its field values, or null when the
   * issue isn't in the project (W1: re-read after a write, with the writer's token).
   */
  async fetchProjectItem(issueNodeId: string): Promise<SnapshotProjectItem | null> {
    const res = await this.gql(
      `query($id:ID!) { node(id:$id) { ... on Issue { projectItems(first:50) { nodes {
        id updatedAt project { number owner { ... on Organization { login } } }
        fieldValues(first:50) { nodes {
          ... on ProjectV2ItemFieldSingleSelectValue { optionId field { ... on ProjectV2FieldCommon { id name } } }
          ... on ProjectV2ItemFieldIterationValue { iterationId field { ... on ProjectV2FieldCommon { id name } } }
        } }
      } } } } }`,
      { id: issueNodeId },
    );
    type Node = GqlItemConnection["nodes"][number] & { project: { number: number; owner: { login?: string } | null } };
    const nodes = (res?.node?.projectItems?.nodes ?? []) as Node[];
    const n = nodes.find((x) => x.project.number === this.projectNumber && x.project.owner?.login?.toLowerCase() === this.org.toLowerCase());
    if (!n) return null;
    const row: SnapshotProjectItem = {
      itemId: n.id,
      updatedAt: n.updatedAt ?? null,
      issueNodeId,
      statusOpt: null,
      priorityOpt: null,
      teamOpt: null,
      platformOpt: null,
      releaseIter: null,
    };
    applyFieldValues(row, n.fieldValues.nodes, this.fields);
    return row;
  }

  /** Walk every page of project items. A project can be far larger than one page. */
  async scanAllProjectItems(): Promise<SnapshotProjectItem[]> {
    const all: SnapshotProjectItem[] = [];
    let cursor: string | null = null;
    for (;;) {
      const page: Awaited<ReturnType<GitHubSource["scanProjectItems"]>> =
        await this.scanProjectItems(cursor);
      all.push(...page.items);
      if (!page.nextCursor) return all;
      cursor = page.nextCursor;
    }
  }
}

type FieldValueNode = { optionId?: string; iterationId?: string; field?: { id?: string; name?: string } };

/**
 * Set a project item's Status/Priority/Team/Platform/Release from GraphQL field
 * values. A value belongs to a key when its field's ID is the mapped field's ID
 * (the name only when the node carries no ID), so a renamed field still maps.
 */
export function applyFieldValues(row: SnapshotProjectItem, values: (FieldValueNode | null)[], map: ProjectFieldMap) {
  const is = (fv: FieldValueNode, key: LogicalField) => {
    const ref = map[key];
    if (!ref) return false;
    return fv.field?.id ? fv.field.id === ref.id : fv.field?.name === ref.name;
  };
  for (const fv of values) {
    if (!fv) continue;
    if (fv.optionId) {
      if (is(fv, "status")) row.statusOpt = fv.optionId;
      else if (is(fv, "priority")) row.priorityOpt = fv.optionId;
      else if (is(fv, "team")) row.teamOpt = fv.optionId;
      else if (is(fv, "platform")) row.platformOpt = fv.optionId;
    } else if (fv.iterationId && is(fv, "release")) {
      // Only the Release iteration field sets this; other iteration fields on
      // the project would otherwise clobber it.
      row.releaseIter = fv.iterationId;
    }
  }
}

type Headers = Record<string, string | undefined>;
/** Octokit's RequestError (`response.headers`) or GraphqlResponseError (`headers`). */
type HttpError = { status?: number; message?: string; headers?: Headers; response?: { headers?: Headers } };

function errorStatus(e: unknown): number | undefined {
  return (e as HttpError | null)?.status;
}

function errorHeaders(e: unknown): Headers {
  const err = e as HttpError | null;
  return err?.response?.headers ?? err?.headers ?? {};
}

/**
 * A 403 is only a rate limit when GitHub says so. Treating every 403 (e.g. a
 * revoked token or missing org approval) as "rate limited for 60s" hid real
 * permission failures behind a misleading chip.
 */
export function isRateLimitError(e: unknown): boolean {
  // GraphQL reports its limit as HTTP 200 with a RATE_LIMITED error.
  const gqlErrors = (e as { errors?: { type?: string }[] } | null)?.errors;
  if (Array.isArray(gqlErrors) && gqlErrors.some((x) => x?.type === "RATE_LIMITED")) return true;
  const status = errorStatus(e);
  if (status === 429) return true;
  if (status !== 403) return false;
  const headers = errorHeaders(e);
  if (headers["x-ratelimit-remaining"] === "0" || headers["retry-after"]) return true;
  return /rate limit/i.test(String((e as HttpError | null)?.message ?? ""));
}

/** GitHub's "no such node" GraphQL error, which still carries partial data. */
export function isNotFoundError(e: unknown): boolean {
  const gqlErrors = (e as { errors?: { type?: string }[] } | null)?.errors;
  return Array.isArray(gqlErrors) && gqlErrors.some((x) => x?.type === "NOT_FOUND");
}

/** Honour Retry-After, then x-ratelimit-reset, else assume 60s. */
export function retryAfterMs(e: unknown): number {
  const headers = errorHeaders(e);
  const retryAfter = Number(headers["retry-after"]);
  if (Number.isFinite(retryAfter) && retryAfter > 0) return retryAfter * 1000;
  const reset = Number(headers["x-ratelimit-reset"]);
  if (Number.isFinite(reset) && reset > 0) {
    const delta = reset * 1000 - Date.now();
    if (delta > 0) return delta;
  }
  return 60_000;
}
