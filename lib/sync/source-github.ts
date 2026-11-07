// Live read-only SyncSource: REST issue change check (ETag/304) +
// periodic project item scan. No writes to GitHub.
import { gqlClient, restClient } from "../github/client";
import { githubTarget, type GithubTarget } from "../config";
import type { ProjectFieldMap, Role } from "./field-map";
import type { SnapshotIssue, SnapshotProjectItem } from "./types";
import type { ChangeCheck, IdResolver, SyncSource } from "./poll";

type RestLabel = { name?: string; id?: number } | string;
type RestMilestone = { number: number; title?: string } | null;

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
type GqlNode = GqlIssueNode & { repository?: { nameWithOwner: string } };

/** An issue fetched by node ID, with the repository it lives in now. */
export type FetchedNode = { kind: "issue"; repo: string; issue: SnapshotIssue };

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
  /** `target`: the stored repository and project (lib/settings.ts); the env target when omitted (CLI, tests). */
  constructor(token: string, ids: IdResolver | undefined, fields: ProjectFieldMap, target: GithubTarget = githubTarget()) {
    this.rest = restClient(token);
    this.gql = gqlClient(token);
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
      for (const i of raw) {
        // The issues endpoint also lists pull requests; Deska skips them (D6).
        if (i.pull_request) continue;
        issues.push(await this.toSnapshotIssue(i));
      }
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
        `query DeskaIssueExtras($ids:[ID!]!) { nodes(ids:$ids) { ... on Issue { id issueType { id } parent { id } } } }`,
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

  /**
   * Node IDs of every open issue in the repo, IDs only (S6 reconcile). One
   * point per page of 100.
   */
  async listOpenNodeIds(): Promise<{ issues: string[] }> {
    const out = { issues: [] as string[] };
    let after: string | null = null;
    for (;;) {
      const res: { repository: { issues: { pageInfo: { hasNextPage: boolean; endCursor: string }; nodes: { id: string }[] } } } = await this.gql(
        `query($owner:String!, $name:String!, $after:String) {
          repository(owner:$owner, name:$name) {
            issues(first:100, after:$after, states:[OPEN]) { pageInfo { hasNextPage endCursor } nodes { id } }
          }
        }`,
        { owner: this.owner, name: this.repo, after },
      );
      const conn = res.repository.issues;
      out.issues.push(...conn.nodes.map((n) => n.id));
      if (!conn.pageInfo.hasNextPage) break;
      after = conn.pageInfo.endCursor;
    }
    return out;
  }

  /**
   * Issues by node ID, wherever they live now (S6 reconcile). A node
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

  /**
   * One page of project items (100) with mapped field values. `fieldValues`
   * asks for 50: a project can have many fields, and a value past the page end
   * would read as "cleared" and wipe that field in the cache.
   */
  async scanProjectItems(cursor: string | null): Promise<{ items: SnapshotProjectItem[]; nextCursor: string | null; total: number }> {
    const res = await this.gql(
      `query DeskaSyncItems($org:String!, $num:Int!, $after:String) {
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
 * Set a project item's values from GraphQL field values (§4.1): every
 * single-select and iteration value goes into `dims` by field ID (so a remap
 * needs no new scan), and the fields mapped to
 * Status, Priority and Sprint also set those columns. A value belongs to a
 * role when its field's ID is the mapped field's ID (the name only when the
 * node carries no ID), so a renamed field still maps.
 */
export function applyFieldValues(row: SnapshotProjectItem, values: (FieldValueNode | null)[], map: ProjectFieldMap) {
  const is = (fv: FieldValueNode, role: Role) => {
    const ref = map[role];
    if (!ref) return false;
    return fv.field?.id ? fv.field.id === ref.id : fv.field?.name === ref.name;
  };
  const dims: Record<string, string> = {};
  for (const fv of values) {
    if (!fv) continue;
    if (fv.optionId) {
      if (fv.field?.id) dims[fv.field.id] = fv.optionId;
      if (is(fv, "status")) row.statusOpt = fv.optionId;
      else if (is(fv, "priority")) row.priorityOpt = fv.optionId;
    } else if (fv.iterationId) {
      if (fv.field?.id) dims[fv.field.id] = fv.iterationId;
      if (!is(fv, "sprint")) continue;
      // Only the mapped Sprint field sets this; other iteration fields on the
      // project would otherwise clobber it.
      row.releaseIter = fv.iterationId;
    }
  }
  if (Object.keys(dims).length) row.dims = dims;
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
