// Real GitHub write client. Sends every mutation with the acting user's own
// token so GitHub history shows the real person. Only reachable when
// WRITE_MODE=on (off in production until IT/security sign-off).
import { gqlClient, restClient } from "./client";
import { githubTarget, pinnedProjectId, type GithubTarget } from "../config";
import { NonRetryableError, type WriteClient } from "../outbox/worker";
import { dimFieldId, isDimKey, type FieldRef, type ProjectFieldMap } from "../sync/field-map";
import type { CreateIssuePayload } from "../outbox/create";
import type { WriteGate } from "../writes/gate";

/**
 * SPEC §4.8: the only GitHub operations Deska may ever send. Anything else
 * throws before a request leaves the process. There is no delete in this list and
 * no field, option or iteration mutation: a test fails when one is added.
 */
export const ALLOWED_MUTATIONS: readonly string[] = [
  // Add an issue to the pinned project (before setting its fields).
  "addProjectV2ItemById",
  // Set or clear a project field value (Sprint, Status, Priority, dimensions).
  "updateProjectV2ItemFieldValue",
  "clearProjectV2ItemFieldValue",
  // Set an issue's type.
  "updateIssueIssueType",
];

/** REST writes the allowlist covers. The REST client is only called through these. */
export const ALLOWED_REST_WRITES: readonly string[] = [
  // Milestone and close/reopen (state, state_reason).
  "issues.update",
  // Create issue (W3).
  "issues.create",
  // Labels and assignees, as deltas.
  "issues.addLabels",
  "issues.removeLabel",
  "issues.addAssignees",
  "issues.removeAssignees",
];

/**
 * The operation allowlist is checked here, not at the call sites: every GraphQL
 * mutation and every REST write goes through these two methods, so an operation
 * added anywhere in this class is refused unless it is on the list.
 */
export class WriteRefused extends NonRetryableError {
  constructor(message: string) {
    super(message);
    this.name = "WriteRefused";
  }
}

/** The mutation's name: the first field inside a GraphQL `mutation` document. */
export function mutationName(query: string): string {
  const m = /\bmutation\b[^{]*\{\s*([A-Za-z_][A-Za-z0-9_]*)/.exec(query);
  if (!m) throw new WriteRefused("refusing a GraphQL mutation without a name");
  return m[1]!;
}

/** Throws unless the mutation is on the allowlist (SPEC §4.8). Exported for the test. */
export function assertAllowedMutation(query: string): string {
  const name = mutationName(query);
  if (!ALLOWED_MUTATIONS.includes(name)) throw new WriteRefused(`refusing GitHub mutation ${name}: not in the operation allowlist (SPEC §4.8)`);
  return name;
}

/** Throws unless the REST write is on the allowlist (SPEC §4.8). Exported for the test. */
export function assertAllowedRest(op: string): string {
  if (!ALLOWED_REST_WRITES.includes(op)) throw new WriteRefused(`refusing GitHub REST write ${op}: not in the operation allowlist (SPEC §4.8)`);
  return op;
}

type FieldMeta = {
  id: string;
  name: string;
  dataType: string;
  options: Map<string, string>; // option id -> name
};
type Meta = { projectId: string; fields: Map<string, FieldMeta> }; // by field ID

/** Edit field keys of the mapped roles ("release" is the Sprint role's key in edits and views). */
const ROLE_OF = { status: "status", priority: "priority", release: "sprint" } as const;

function sortedNames(rows: { login?: string | null; name?: string | null }[]): string[] {
  return rows.map((r) => (r.login ?? r.name) as string).sort();
}

export class GitHubWriteClient implements WriteClient {
  private rest: ReturnType<typeof restClient>;
  private gql: ReturnType<typeof gqlClient>;
  private owner: string;
  private repo: string;
  private org: string;
  private projectNumber: number;
  private meta?: Promise<Meta>;
  private items = new Map<string, string>();

  /** `fields` is the discovered logical-key -> field-ID map; fields resolve by ID, never by name (v5 1.3). */
  /** The pinned project node ID: the stored one (onboarding), else `GITHUB_PROJECT_ID`. */
  private pinned: string | null;

  constructor(
    token: string,
    private fieldMap: ProjectFieldMap,
    target: GithubTarget & { projectId?: string | null } = githubTarget(),
    /** SPEC §3.4: defence in depth — the routes check the gate, and no code path may hold a write client while it is off. */
    gate: Pick<WriteGate, "allowed"> = { allowed: false },
  ) {
    if (!gate.allowed) throw new WriteRefused("GitHub writes are disabled by the write gate (SPEC §3.4)");
    this.rest = restClient(token);
    this.gql = gqlClient(token);
    // No production defaults: a sandbox deployment with one variable missing
    // must not write to a real repo or project (v5 1.2).
    this.owner = target.owner;
    this.repo = target.repo;
    this.org = target.org;
    this.projectNumber = target.projectNumber;
    this.pinned = target.projectId ?? pinnedProjectId();
  }

  /** A GraphQL mutation, refused unless its name is on the allowlist (SPEC §4.8). */
  private async mutate(query: string, variables: Record<string, unknown>): Promise<any> {
    assertAllowedMutation(query);
    return this.gql(query, variables);
  }

  /** A REST write, refused unless its operation is on the allowlist (SPEC §4.8). */
  private async restWrite(op: string, params: Record<string, unknown>): Promise<any> {
    assertAllowedRest(op);
    // `issues.update` -> `this.rest.issues.update` (the client is already the issues API).
    const method = op.replace(/^issues\./, "");
    return (this.rest.issues as unknown as Record<string, (p: Record<string, unknown>) => Promise<any>>)[method]!(params);
  }

  private loadMeta(): Promise<Meta> {
    if (!this.meta) {
      const meta = (async (): Promise<Meta> => {
        // Page through the fields: a field past the first page would read as
        // "field not found" and block every write to it (v5 2.7).
        let project: { id: string } | undefined;
        const nodes: { id: string; name: string; dataType: string; options?: { id: string; name: string }[] }[] = [];
        let after: string | null = null;
        for (;;) {
          const res: any = await this.gql(
            `query($org:String!, $num:Int!, $after:String) {
              organization: repositoryOwner(login:$org) { ... on ProjectV2Owner { projectV2(number:$num) {
                id
                fields(first:100, after:$after) {
                  pageInfo { hasNextPage endCursor }
                  nodes {
                    ... on ProjectV2SingleSelectField { id name dataType options { id name } }
                    ... on ProjectV2IterationField { id name dataType }
                    ... on ProjectV2Field { id name dataType }
                  }
                }
              } } }
            }`,
            { org: this.org, num: this.projectNumber, after },
          );
          project = res.organization.projectV2;
          nodes.push(...res.organization.projectV2.fields.nodes);
          const page = res.organization.projectV2.fields.pageInfo;
          if (!page?.hasNextPage) break;
          after = page.endCursor;
        }
        const pinned = this.pinned;
        if (pinned && project!.id !== pinned) {
          throw new NonRetryableError(`project ${this.projectNumber} resolves to a different project than the pinned one; refusing to write`);
        }
        const fields = new Map<string, FieldMeta>();
        for (const f of nodes) {
          fields.set(f.id, {
            id: f.id,
            name: f.name,
            dataType: f.dataType,
            options: new Map((f.options ?? []).map((o) => [o.id, o.name])),
          });
        }
        return { projectId: project!.id, fields };
      })();
      // Don't cache a failure: one transient error would otherwise fail every
      // later write through this client.
      meta.catch(() => {
        if (this.meta === meta) this.meta = undefined;
      });
      this.meta = meta;
    }
    return this.meta;
  }

  /** The project field a logical key points at. Throws, without retries, when there is none. */
  private refFor(field: string | null): FieldRef {
    if (isDimKey(field)) {
      const ref = this.fieldMap.dimensions.find((d) => d.id === dimFieldId(field));
      if (!ref) throw new NonRetryableError(`the field ${dimFieldId(field)} is not a mapped dimension`);
      return ref;
    }
    const role = field && field in ROLE_OF ? ROLE_OF[field as keyof typeof ROLE_OF] : null;
    if (!role) throw new NonRetryableError(`unsupported field: ${field}`);
    const ref = this.fieldMap[role];
    if (!ref) throw new NonRetryableError(`the project has no ${field} field`);
    return ref;
  }

  private async findItem(issueNodeId: string): Promise<string | null> {
    const cached = this.items.get(issueNodeId);
    if (cached) return cached;
    const meta = await this.loadMeta();
    // Page through project items: the first 20 did not cover issues that live
    // in many projects, and a miss here would add a *second* project item for an
    // issue that already had one.
    let cursor: string | null = null;
    for (;;) {
      const res = await this.gql(
        `query($id:ID!, $after:String) { node(id:$id) { ... on Issue { projectItems(first:100, after:$after) {
          pageInfo { hasNextPage endCursor }
          nodes { id project { id } } } } } }`,
        { id: issueNodeId, after: cursor },
      );
      const conn = res.node?.projectItems;
      if (!conn) return null;
      const existing = conn.nodes?.find(
        (n: { project: { id: string } }) => n.project.id === meta.projectId,
      );
      if (existing) {
        this.items.set(issueNodeId, existing.id);
        return existing.id;
      }
      if (!conn.pageInfo?.hasNextPage) return null;
      cursor = conn.pageInfo.endCursor;
    }
  }

  private async itemFor(issueNodeId: string): Promise<string> {
    const existing = await this.findItem(issueNodeId);
    if (existing) return existing;
    const meta = await this.loadMeta();
    const added = await this.mutate(
      `mutation($project:ID!, $content:ID!) { addProjectV2ItemById(input:{projectId:$project, contentId:$content}) { item { id } } }`,
      { project: meta.projectId, content: issueNodeId },
    );
    const id = added.addProjectV2ItemById.item.id;
    this.items.set(issueNodeId, id);
    return id;
  }

  async readField(issueNodeId: string, field: string | null): Promise<unknown> {
    if (field === "type") {
      // GraphQL for Type (M0 §f): the native issue type's node ID, or null.
      const res = await this.gql(`query($id:ID!) { node(id:$id) { ... on Issue { issueType { id } } } }`, { id: issueNodeId });
      return res.node?.issueType?.id ?? null;
    }
    if (field === "milestone") {
      const res = await this.rest.issues.get({ owner: this.owner, repo: this.repo, issue_number: await this.issueNumber(issueNodeId) });
      // The cache keys milestones by number (as a string).
      return res.data.milestone ? String(res.data.milestone.number) : null;
    }
    if (field === "state") {
      const res = await this.rest.issues.get({
        owner: this.owner,
        repo: this.repo,
        issue_number: await this.issueNumber(issueNodeId),
      });
      return res.data.state;
    }
    if (field === "labels" || field === "assignees") {
      const res = await this.rest.issues.get({
        owner: this.owner,
        repo: this.repo,
        issue_number: await this.issueNumber(issueNodeId),
      });
      return field === "labels"
        ? sortedNames(res.data.labels.map((l) => (typeof l === "string" ? { name: l } : l)))
        : sortedNames(res.data.assignees ?? []);
    }
    const ref = this.refFor(field);
    // One query for the item and its first page of values, the common case.
    // A cached item ID, a second page of items or of values falls through to
    // the paged lookups below.
    if (!this.items.has(issueNodeId)) {
      const meta = await this.loadMeta();
      const res: any = await this.gql(
        `query($id:ID!) { node(id:$id) { ... on Issue { projectItems(first:100) {
          pageInfo { hasNextPage }
          nodes { id project { id } fieldValues(first:50) {
            pageInfo { hasNextPage }
            nodes {
              ... on ProjectV2ItemFieldSingleSelectValue { optionId field { ... on ProjectV2FieldCommon { id name } } }
              ... on ProjectV2ItemFieldIterationValue { iterationId field { ... on ProjectV2FieldCommon { id name } } }
            }
          } } } } } }`,
        { id: issueNodeId },
      );
      const conn = res.node?.projectItems;
      const item = conn?.nodes?.find((n: { project: { id: string } }) => n.project.id === meta.projectId);
      if (item) {
        this.items.set(issueNodeId, item.id);
        const values = item.fieldValues;
        for (const fv of values?.nodes ?? []) {
          if (fv?.field?.id === ref.id) return fv.optionId ?? fv.iterationId ?? null;
        }
        if (values && !values.pageInfo?.hasNextPage) return null;
      } else if (conn && !conn.pageInfo?.hasNextPage) {
        return null; // not in the project yet — nothing to read
      }
    }
    const itemId = await this.findItem(issueNodeId);
    if (!itemId) return null; // not in the project yet — nothing to read
    // Page through the item's field values until the mapped field turns up. A
    // value past a page cap used to read as null, so a stale base passed the
    // check and the write overwrote a value someone else had set (v5 2.7).
    let after: string | null = null;
    for (;;) {
      const res: any = await this.gql(
        `query($item:ID!, $after:String) { node(id:$item) { ... on ProjectV2Item { fieldValues(first:50, after:$after) {
          pageInfo { hasNextPage endCursor }
          nodes {
            ... on ProjectV2ItemFieldSingleSelectValue { optionId field { ... on ProjectV2FieldCommon { id name } } }
            ... on ProjectV2ItemFieldIterationValue { iterationId field { ... on ProjectV2FieldCommon { id name } } }
          }
        } } } }`,
        { item: itemId, after },
      );
      const values = res.node?.fieldValues;
      for (const fv of values?.nodes ?? []) {
        if (fv?.field?.id === ref.id) return fv.optionId ?? fv.iterationId ?? null;
      }
      if (!values?.pageInfo?.hasNextPage) return null;
      after = values.pageInfo.endCursor;
    }
  }

  async applyField(issueNodeId: string, field: string | null, next: unknown): Promise<void> {
    if (field === "type") {
      await this.mutate(
        `mutation($issue:ID!, $type:ID) { updateIssueIssueType(input:{issueId:$issue, issueTypeId:$type}) { issue { id } } }`,
        { issue: issueNodeId, type: next ?? null },
      );
      return;
    }
    if (field === "milestone") {
      await this.restWrite("issues.update", {
        owner: this.owner,
        repo: this.repo,
        issue_number: await this.issueNumber(issueNodeId),
        milestone: next == null ? null : Number(next),
      });
      return;
    }
    if (field === "labels" || field === "assignees") {
      const delta = next as { added: string[]; removed: string[] };
      const issue_number = await this.issueNumber(issueNodeId);
      if (field === "labels") {
        for (const name of delta.removed) {
          try {
            await this.restWrite("issues.removeLabel", { owner: this.owner, repo: this.repo, issue_number, name });
          } catch (e) {
            // 404: the label is already off the issue (removed concurrently),
            // which is the state this delta asked for.
            if ((e as { status?: number }).status !== 404) throw e;
          }
        }
        for (const name of delta.added) await this.restWrite("issues.addLabels", { owner: this.owner, repo: this.repo, issue_number, labels: [name] });
      } else {
        for (const login of delta.removed) await this.restWrite("issues.removeAssignees", { owner: this.owner, repo: this.repo, issue_number, assignees: [login] });
        if (delta.added.length) await this.restWrite("issues.addAssignees", { owner: this.owner, repo: this.repo, issue_number, assignees: delta.added });
      }
      return;
    }
    const meta = await this.loadMeta();
    const ref = this.refFor(field);
    const def = meta.fields.get(ref.id);
    if (!def) throw new NonRetryableError(`the ${ref.name} field is no longer in the project`);
    const itemId = await this.itemFor(issueNodeId);
    if (next == null) {
      await this.mutate(
        `mutation($project:ID!, $item:ID!, $field:ID!) { clearProjectV2ItemFieldValue(input:{projectId:$project, itemId:$item, fieldId:$field}) { clientMutationId } }`,
        { project: meta.projectId, item: itemId, field: def.id },
      );
      return;
    }
    const valueKey = def.dataType === "ITERATION" ? "iterationId" : "singleSelectOptionId";
    // GitHub types both `singleSelectOptionId` and `iterationId` as String, not
    // ID: declaring `$value:ID!` makes GitHub refuse every project field write.
    await this.mutate(
      `mutation($project:ID!, $item:ID!, $field:ID!, $value:String!) {
        updateProjectV2ItemFieldValue(input:{projectId:$project, itemId:$item, fieldId:$field, value:{${valueKey}:$value}}) { clientMutationId }
      }`,
      { project: meta.projectId, item: itemId, field: def.id, value: next },
    );
  }

  /**
   * Create the issue (SPEC §4.8, W3). Type is set afterwards through GraphQL,
   * because REST's create does not take an issue type; labels, assignees and the
   * milestone go in the create payload so GitHub records one create, not four
   * updates. Returns the new issue's node ID and number.
   */
  async createIssue(payload: CreateIssuePayload): Promise<{ nodeId: string; number: number }> {
    const created = await this.restWrite("issues.create", {
      owner: this.owner,
      repo: this.repo,
      title: payload.title,
      body: payload.body,
      ...(payload.labelNames.length ? { labels: payload.labelNames } : {}),
      ...(payload.assigneeLogins.length ? { assignees: payload.assigneeLogins } : {}),
      ...(payload.milestoneNumber != null ? { milestone: payload.milestoneNumber } : {}),
    });
    // Octokit resolves to the response ({ status, headers, data }); the issue is in `data`.
    const data = ((created as { data?: unknown } | null)?.data ?? {}) as { node_id?: unknown; number?: unknown };
    if (typeof data.node_id !== "string" || !data.node_id || typeof data.number !== "number") {
      throw new NonRetryableError("GitHub created the issue but returned no node ID; nothing else was written");
    }
    this.items.set(data.node_id, "");
    return { nodeId: data.node_id, number: data.number };
  }

  /**
   * An issue this token's user already created from `payload` at or after `since`
   * (W3). A create whose answer was lost (a timeout, a 502 after GitHub committed)
   * is looked up before it is sent again, so a retry never makes a second issue.
   */
  async findCreatedIssue(payload: CreateIssuePayload, since: Date): Promise<{ nodeId: string; number: number } | null> {
    const me = await this.rest.users.getAuthenticated();
    const login = me.data.login;
    // A little slack for clock skew between this machine and GitHub.
    const from = new Date(since.getTime() - 5 * 60_000);
    const res = await this.rest.issues.listForRepo({
      owner: this.owner,
      repo: this.repo,
      creator: login,
      state: "all",
      sort: "created",
      direction: "desc",
      since: from.toISOString(),
      per_page: 50,
    });
    const hit = res.data.find(
      (i) =>
        !i.pull_request &&
        i.title === payload.title &&
        (i.body ?? "") === payload.body &&
        new Date(i.created_at).getTime() >= from.getTime(),
    );
    return hit ? { nodeId: hit.node_id, number: hit.number } : null;
  }

  /** Add an existing issue to the pinned project (W3); reuses the item lookup. */
  async addProjectItem(issueNodeId: string): Promise<void> {
    await this.itemFor(issueNodeId);
  }

  async closeIssue(issueNodeId: string): Promise<void> {
    await this.restWrite("issues.update", {
      owner: this.owner,
      repo: this.repo,
      issue_number: await this.issueNumber(issueNodeId),
      state: "closed",
      state_reason: "completed",
    });
  }

  async reopenIssue(issueNodeId: string): Promise<void> {
    // Reopen leaves Status alone (SPEC §4.8): state only, no state_reason.
    await this.restWrite("issues.update", {
      owner: this.owner,
      repo: this.repo,
      issue_number: await this.issueNumber(issueNodeId),
      state: "open",
    });
  }

  /**
   * The issue's number in the configured repo. REST writes address `owner/repo`
   * plus a number, so an issue transferred to another repo would send the write
   * to an unrelated issue here: the node's own repository must match (v5 1.1).
   */
  private async issueNumber(issueNodeId: string): Promise<number> {
    const res = await this.gql(`query($id:ID!) { node(id:$id) { ... on Issue { number repository { nameWithOwner } } } }`, {
      id: issueNodeId,
    });
    const node = res.node as { number: number; repository?: { nameWithOwner?: string } } | null;
    if (!node) throw new NonRetryableError("the issue no longer exists on GitHub");
    const actual = node.repository?.nameWithOwner ?? "";
    const expected = `${this.owner}/${this.repo}`;
    if (actual.toLowerCase() !== expected.toLowerCase()) {
      throw new NonRetryableError(`this issue now lives in ${actual || "another repository"}, not ${expected}; nothing was written`);
    }
    return node.number;
  }
}
