// Real GitHub write client. Sends every mutation with the acting user's own
// token so GitHub history shows the real person. Only reachable when
// WRITE_MODE=on (off in production until IT/security sign-off).
import { gqlClient, restClient } from "./client";
import { githubTarget, pinnedProjectId, type GithubTarget } from "../config";
import { writeEnabled } from "../outbox/queue";
import { NonRetryableError, type WriteClient } from "../outbox/worker";
import { dimFieldId, isDimKey, type FieldRef, type ProjectFieldMap } from "../sync/field-map";

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

  constructor(token: string, private fieldMap: ProjectFieldMap, target: GithubTarget & { projectId?: string | null } = githubTarget()) {
    // Defence in depth (AGENTS.md): the routes check WRITE_MODE too, but no
    // code path may hold a write client while writes are off.
    if (!writeEnabled()) throw new Error("GitHub writes are disabled (WRITE_MODE is not on)");
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
              organization(login:$org) { projectV2(number:$num) {
                id
                fields(first:100, after:$after) {
                  pageInfo { hasNextPage endCursor }
                  nodes {
                    ... on ProjectV2SingleSelectField { id name dataType options { id name } }
                    ... on ProjectV2IterationField { id name dataType }
                    ... on ProjectV2Field { id name dataType }
                  }
                }
              } }
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
    const added = await this.gql(
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
      await this.gql(
        `mutation($issue:ID!, $type:ID) { updateIssueIssueType(input:{issueId:$issue, issueTypeId:$type}) { issue { id } } }`,
        { issue: issueNodeId, type: next ?? null },
      );
      return;
    }
    if (field === "milestone") {
      await this.rest.issues.update({
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
            await this.rest.issues.removeLabel({ owner: this.owner, repo: this.repo, issue_number, name });
          } catch (e) {
            // 404: the label is already off the issue (removed concurrently),
            // which is the state this delta asked for.
            if ((e as { status?: number }).status !== 404) throw e;
          }
        }
        for (const name of delta.added) await this.rest.issues.addLabels({ owner: this.owner, repo: this.repo, issue_number, labels: [name] });
      } else {
        for (const login of delta.removed) await this.rest.issues.removeAssignees({ owner: this.owner, repo: this.repo, issue_number, assignees: [login] });
        if (delta.added.length) await this.rest.issues.addAssignees({ owner: this.owner, repo: this.repo, issue_number, assignees: delta.added });
      }
      return;
    }
    const meta = await this.loadMeta();
    const ref = this.refFor(field);
    const def = meta.fields.get(ref.id);
    if (!def) throw new NonRetryableError(`the ${ref.name} field is no longer in the project`);
    const itemId = await this.itemFor(issueNodeId);
    if (next == null) {
      await this.gql(
        `mutation($project:ID!, $item:ID!, $field:ID!) { clearProjectV2ItemFieldValue(input:{projectId:$project, itemId:$item, fieldId:$field}) { clientMutationId } }`,
        { project: meta.projectId, item: itemId, field: def.id },
      );
      return;
    }
    const valueKey = def.dataType === "ITERATION" ? "iterationId" : "singleSelectOptionId";
    await this.gql(
      `mutation($project:ID!, $item:ID!, $field:ID!, $value:ID!) {
        updateProjectV2ItemFieldValue(input:{projectId:$project, itemId:$item, fieldId:$field, value:{${valueKey}:$value}}) { clientMutationId }
      }`,
      { project: meta.projectId, item: itemId, field: def.id, value: next },
    );
  }

  async closeIssue(issueNodeId: string): Promise<void> {
    await this.rest.issues.update({
      owner: this.owner,
      repo: this.repo,
      issue_number: await this.issueNumber(issueNodeId),
      state: "closed",
    });
  }

  async reopenIssue(issueNodeId: string): Promise<void> {
    await this.rest.issues.update({
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
