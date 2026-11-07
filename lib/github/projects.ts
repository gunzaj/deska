// Project discovery for onboarding step 2 (SPEC D4, §4.1): the org projects a
// token can read, and one project's fields with their options and iterations.
// Read-only: every call goes through the probe's client (GET and GraphQL
// queries only), so picking a project can never change anything on GitHub.
import { redactSecrets } from "../redact";
import type { SnapshotField } from "../sync/types";
import { classify } from "./connection";
import { MESSAGES, permissionName, hhmm } from "./token-states";
import type { ProbeResponse, ReadOnlyClient } from "./probe";

export type OrgProject = { id: string; number: number; title: string; closed: boolean };
export type ProjectDetail = { id: string; number: number; title: string; fields: SnapshotField[] };

/** A read that failed, with the message the user sees (§3.3: never an empty list). */
export class ProjectReadError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ProjectReadError";
  }
}

/** The data of a response, or a ProjectReadError saying why there is none. */
function dataOf(res: ProbeResponse, what: string): Record<string, unknown> {
  const o = classify(res, new Date());
  switch (o.kind) {
    case "ok":
      return ((o.data as { data?: Record<string, unknown> } | null)?.data ?? {}) as Record<string, unknown>;
    case "invalid":
      throw new ProjectReadError(MESSAGES.invalid, 401);
    case "offline":
      throw new ProjectReadError(MESSAGES.offline, 503);
    case "rate-limited":
      throw new ProjectReadError(MESSAGES.rateLimited(hhmm(o.until)), 429);
    case "org-refused":
      throw new ProjectReadError(MESSAGES.awaitingApproval, 403);
    case "denied":
      throw new ProjectReadError(MESSAGES.missingPermission([permissionName("projects")]), 403);
    case "not-found":
      throw new ProjectReadError(`${what} not found, or not visible to this token.${o.detail ? ` GitHub says: ${redactSecrets(o.detail)}` : ""}`, 404);
  }
}

async function call(fn: () => Promise<ProbeResponse>): Promise<ProbeResponse> {
  try {
    return await fn();
  } catch {
    // A network error or timeout; the error text may carry the URL.
    throw new ProjectReadError(MESSAGES.offline, 503);
  }
}

const PROJECTS_QUERY = `query DeskaOrgProjects($org: String!, $after: String) {
  organization: repositoryOwner(login: $org) {
    ... on ProjectV2Owner {
      projectsV2(first: 50, after: $after, orderBy: { field: TITLE, direction: ASC }) {
        pageInfo { hasNextPage endCursor }
        nodes { id number title closed }
      }
    }
  }
}`;

/** Every project of `org` the token can read, open ones first. */
export async function listOrgProjects(client: ReadOnlyClient, org: string): Promise<OrgProject[]> {
  const out: OrgProject[] = [];
  let after: string | null = null;
  for (let page = 0; page < 20; page++) {
    const data = dataOf(await call(() => client.graphql(PROJECTS_QUERY, { org, after })), `Organization or user "${org}"`);
    const conn = (data.organization as { projectsV2?: { pageInfo: { hasNextPage: boolean; endCursor: string }; nodes: (OrgProject | null)[] } } | null)?.projectsV2;
    if (!conn) throw new ProjectReadError(`Organization or user "${org}" not found, or not visible to this token.`, 404);
    for (const n of conn.nodes) if (n?.id) out.push({ id: n.id, number: n.number, title: n.title, closed: !!n.closed });
    if (!conn.pageInfo.hasNextPage) break;
    after = conn.pageInfo.endCursor;
  }
  return out.sort((a, b) => Number(a.closed) - Number(b.closed) || a.title.localeCompare(b.title));
}

const FIELDS_QUERY = `query DeskaProjectFields($org: String!, $number: Int!, $after: String) {
  organization: repositoryOwner(login: $org) {
    ... on ProjectV2Owner {
      projectV2(number: $number) {
        id number title
        fields(first: 50, after: $after) {
          pageInfo { hasNextPage endCursor }
          nodes {
            ... on ProjectV2FieldCommon { id name dataType }
            ... on ProjectV2SingleSelectField { options { id name color } }
            ... on ProjectV2IterationField { configuration { iterations { id title startDate duration } completedIterations { id title startDate duration } } }
          }
        }
      }
    }
  }
}`;

type GqlField = {
  id?: string;
  name?: string;
  dataType?: string;
  options?: { id: string; name: string; color: string }[];
  configuration?: { iterations?: SnapshotField["iterations"]; completedIterations?: SnapshotField["iterations"] };
};

/** One project with all its fields (options and iterations included), discovered, never assumed. */
export async function fetchProjectDetail(client: ReadOnlyClient, org: string, number: number): Promise<ProjectDetail> {
  let project: { id: string; number: number; title: string } | null = null;
  const fields: SnapshotField[] = [];
  let after: string | null = null;
  for (let page = 0; page < 20; page++) {
    const data = dataOf(await call(() => client.graphql(FIELDS_QUERY, { org, number, after })), `Project ${number} in "${org}"`);
    const p = (data.organization as { projectV2?: { id: string; number: number; title: string; fields: { pageInfo: { hasNextPage: boolean; endCursor: string }; nodes: (GqlField | null)[] } } | null } | null)?.projectV2;
    if (!p) throw new ProjectReadError(`Project ${number} in "${org}" not found, or not visible to this token.`, 404);
    project = { id: p.id, number: p.number, title: p.title };
    for (const f of p.fields.nodes) {
      if (!f?.id || !f.name || !f.dataType) continue;
      const iterations = f.configuration ? [...(f.configuration.iterations ?? []), ...(f.configuration.completedIterations ?? [])] : undefined;
      fields.push({ id: f.id, name: f.name, dataType: f.dataType, ...(f.options ? { options: f.options } : {}), ...(iterations ? { iterations } : {}) });
    }
    if (!p.fields.pageInfo.hasNextPage) break;
    after = p.fields.pageInfo.endCursor;
  }
  return { ...project!, fields };
}

/** Whether the token can read the repository (`GET /repos/{owner}/{repo}`). */
export async function checkRepo(client: ReadOnlyClient, repoFull: string): Promise<void> {
  const [owner, repo] = repoFull.split("/") as [string, string];
  const res = await call(() => client.rest("GET", `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`));
  const o = classify(res, new Date());
  if (o.kind === "ok") return;
  if (o.kind === "not-found") throw new ProjectReadError(`Repository ${repoFull} not found, or not selected for this token.`, 404);
  if (o.kind === "denied") throw new ProjectReadError(MESSAGES.missingPermission([permissionName("metadata")]), 403);
  dataOf(res, `Repository ${repoFull}`);
}
