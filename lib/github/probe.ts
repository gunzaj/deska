// Read-only token probe (SPEC D1). Records which of Deska's GitHub calls a
// fine-grained PAT can make, with the raw status and message of each failure.
//
// The client here is deliberately not Octokit: it is a thin `fetch` wrapper
// that can only send REST `GET`s and GraphQL documents without a `mutation`
// or `subscription`. Anything else throws before a request leaves the process,
// so running the probe can never change anything on GitHub.

const API = "https://api.github.com";

export class ProbeWriteRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProbeWriteRefused";
  }
}

/** One response as the probe records it. `data` is parsed JSON or text. */
export type ProbeResponse = {
  status: number;
  headers: Record<string, string>;
  data: unknown;
};

/** Headers worth keeping: they tell the token states of SPEC §3.3 apart. */
const KEPT_HEADERS = [
  "github-authentication-token-expiration",
  "x-accepted-github-permissions",
  "x-oauth-scopes",
  "x-ratelimit-remaining",
  "x-ratelimit-reset",
  "x-ratelimit-resource",
  "retry-after",
];

/**
 * Strips `#` comments and string literals (block strings included) from a
 * GraphQL document, so a keyword inside either can't hide or fake an
 * operation type.
 */
function stripCommentsAndStrings(doc: string): string {
  return doc
    .replace(/"""[\s\S]*?"""/g, '""')
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/#[^\n\r]*/g, "");
}

/**
 * Throws unless every operation in `doc` is a query. Accepts the query
 * shorthand (`{ … }`) and named or anonymous `query` operations. Refuses
 * `mutation` and `subscription` anywhere outside comments and strings, and
 * any document that doesn't start with a query.
 */
export function assertQueryOnly(doc: string): void {
  const code = stripCommentsAndStrings(doc).trim();
  if (/\b(?:mutation|subscription)\b/i.test(code)) {
    throw new ProbeWriteRefused("the probe client refuses GraphQL mutations and subscriptions");
  }
  if (!/^(?:query\b|\{)/.test(code)) {
    throw new ProbeWriteRefused("the probe client only sends GraphQL query documents");
  }
}

export type ReadOnlyClient = {
  /** REST call. Only `GET` is allowed; `path` is relative to the API root. */
  rest(method: string, path: string, opts?: { accept?: string }): Promise<ProbeResponse>;
  /** GraphQL query. Mutations and subscriptions throw before any request. */
  graphql(query: string, variables?: Record<string, unknown>): Promise<ProbeResponse>;
};

export function createReadOnlyClient(
  token: string,
  fetchImpl: typeof fetch = fetch,
  { apiBase = API, userAgent = "deska-probe", timeoutMs = 30_000 }: { apiBase?: string; userAgent?: string; timeoutMs?: number } = {},
): ReadOnlyClient {
  const headersFor = (accept = "application/vnd.github+json"): Record<string, string> => ({
    authorization: `Bearer ${token}`,
    accept,
    "x-github-api-version": "2022-11-28",
    "user-agent": userAgent,
  });

  async function send(url: string, init: RequestInit): Promise<ProbeResponse> {
    const res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    const headers: Record<string, string> = {};
    for (const h of KEPT_HEADERS) {
      const v = res.headers.get(h);
      if (v !== null) headers[h] = v;
    }
    const text = await res.text();
    let data: unknown = text;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      // Not JSON (e.g. a rendered body): keep the text.
    }
    return { status: res.status, headers, data };
  }

  return {
    async rest(method, path, opts) {
      if (method.toUpperCase() !== "GET") {
        throw new ProbeWriteRefused(`the probe client refuses REST ${method.toUpperCase()}; only GET is allowed`);
      }
      if (!path.startsWith("/") || path.startsWith("//")) {
        throw new ProbeWriteRefused("REST paths must be relative to the GitHub API root");
      }
      return send(`${apiBase}${path}`, { method: "GET", headers: headersFor(opts?.accept) });
    },
    async graphql(query, variables = {}) {
      assertQueryOnly(query);
      return send(`${apiBase}/graphql`, {
        method: "POST",
        headers: { ...headersFor(), "content-type": "application/json" },
        body: JSON.stringify({ query, variables }),
      });
    },
  };
}

// ---------------------------------------------------------------------------
// The checks

export type ProbeTarget = { owner: string; repo: string; org: string; projectNumber: number; issueNumber?: number };

export type ProbeCheck = {
  /** Short ID, stable across runs. */
  id: string;
  /** What Deska uses the call for. */
  call: string;
  /** The permission it needs (SPEC §3.2). */
  permission: string;
  ok: boolean;
  status: number | null;
  /** GitHub's message or GraphQL errors on failure; a short summary on success. */
  message: string;
};

export type ProbeReport = {
  ranAt: string;
  target: { repo: string; org: string; projectNumber: number; issueNumber: number | null };
  /** From `github-authentication-token-expiration`, if GitHub sent it. */
  tokenExpiration: string | null;
  checks: ProbeCheck[];
};

function errorMessage(r: ProbeResponse): string {
  const d = r.data as { message?: unknown; errors?: { message?: unknown; type?: unknown }[] } | null;
  if (d && Array.isArray(d.errors) && d.errors.length) {
    return d.errors.map((e) => [e.type, e.message].filter(Boolean).join(": ")).join("; ");
  }
  if (d && typeof d.message === "string") return d.message;
  if (typeof r.data === "string") return r.data.slice(0, 300);
  return "";
}

/** A GraphQL response is only OK with a 200, no errors and the data present. */
function gqlOk(r: ProbeResponse, pick: (data: any) => unknown): boolean {
  const d = r.data as { data?: unknown; errors?: unknown[] } | null;
  return r.status === 200 && !(d?.errors && d.errors.length) && pick(d?.data) != null;
}

const count = (v: unknown, noun: string) => `${Array.isArray(v) ? v.length : 0} ${noun}`;

type CheckDef = {
  id: string;
  call: string;
  permission: string;
  run: (c: ReadOnlyClient, t: Required<ProbeTarget>) => Promise<{ res: ProbeResponse; ok: boolean; summary: string }>;
};

const rest = (path: string, summary: (data: any) => string, accept?: string): CheckDef["run"] =>
  async (c) => {
    const res = await c.rest("GET", path, { accept });
    const ok = res.status >= 200 && res.status < 300;
    return { res, ok, summary: ok ? summary(res.data) : "" };
  };

const ISSUE_DETAIL = `query($owner:String!, $repo:String!, $num:Int!) { repository(owner:$owner, name:$repo) {
  issue(number:$num) { id number issueType { id name } parent { id number }
    subIssuesSummary { total completed percentCompleted }
    subIssues(first:5) { totalCount nodes { id number state } } } } }`;

const PROJECT_FIELDS = `query($org:String!, $num:Int!) { organization(login:$org) { projectV2(number:$num) {
  id fields(first:40) { nodes {
    ... on ProjectV2Field { id dataType }
    ... on ProjectV2SingleSelectField { id dataType options { id } }
    ... on ProjectV2IterationField { id dataType configuration { iterations { id } completedIterations { id } } }
  } } } } }`;

const PROJECT_ITEMS = `query($org:String!, $num:Int!) { organization(login:$org) { projectV2(number:$num) {
  items(first:5, query:"is:issue") { totalCount nodes { id content { ... on Issue { number } } } } } } }`;

const ISSUE_TYPES = `query($org:String!) { organization(login:$org) { issueTypes(first:20) { nodes { id } } } }`;

const CHECKS: CheckDef[] = [
  {
    id: "user",
    call: "GET /user (token owner)",
    permission: "none (any valid token)",
    run: rest("/user", () => "token owner readable"),
  },
  {
    id: "repo",
    call: "GET /repos/{owner}/{repo}",
    permission: "Repository → Metadata: Read",
    run: (c, t) => rest(`/repos/${t.owner}/${t.repo}`, () => "repository readable")(c, t),
  },
  {
    id: "issues-since",
    call: "GET /repos/{owner}/{repo}/issues?since=…",
    permission: "Repository → Issues: Read",
    run: (c, t) => {
      const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
      return rest(
        `/repos/${t.owner}/${t.repo}/issues?state=all&since=${encodeURIComponent(since)}&per_page=5`,
        (d) => count(d, "issues in the first page"),
      )(c, t);
    },
  },
  {
    id: "issue-detail",
    call: "GraphQL issue detail (issueType, parent, subIssues, subIssuesSummary)",
    permission: "Repository → Issues: Read",
    run: async (c, t) => {
      const res = await c.graphql(ISSUE_DETAIL, { owner: t.owner, repo: t.repo, num: t.issueNumber });
      const ok = gqlOk(res, (d) => d?.repository?.issue);
      const i = (res.data as any)?.data?.repository?.issue;
      return { res, ok, summary: ok ? `subIssuesSummary.total=${i.subIssuesSummary?.total ?? "?"}` : "" };
    },
  },
  {
    id: "project-fields",
    call: "GraphQL project fields, options, iterations",
    permission: "Organization → Projects: Read",
    run: async (c, t) => {
      const res = await c.graphql(PROJECT_FIELDS, { org: t.org, num: t.projectNumber });
      const ok = gqlOk(res, (d) => d?.organization?.projectV2);
      return { res, ok, summary: ok ? count((res.data as any).data.organization.projectV2.fields?.nodes, "fields") : "" };
    },
  },
  {
    id: "project-items-query",
    call: "GraphQL project items with items(query:)",
    permission: "Organization → Projects: Read",
    run: async (c, t) => {
      const res = await c.graphql(PROJECT_ITEMS, { org: t.org, num: t.projectNumber });
      const ok = gqlOk(res, (d) => d?.organization?.projectV2?.items);
      return { res, ok, summary: ok ? `totalCount=${(res.data as any).data.organization.projectV2.items.totalCount}` : "" };
    },
  },
  {
    id: "org-issue-types",
    call: "GraphQL organization.issueTypes",
    permission: "Organization → Issue types: Read (optional)",
    run: async (c, t) => {
      const res = await c.graphql(ISSUE_TYPES, { org: t.org });
      const ok = gqlOk(res, (d) => d?.organization?.issueTypes);
      return { res, ok, summary: ok ? count((res.data as any).data.organization.issueTypes.nodes, "issue types") : "" };
    },
  },
  {
    id: "assignees",
    call: "GET /repos/{owner}/{repo}/assignees",
    permission: "Repository → Metadata: Read",
    run: (c, t) => rest(`/repos/${t.owner}/${t.repo}/assignees?per_page=5`, (d) => count(d, "users in the first page"))(c, t),
  },
  {
    id: "labels",
    call: "GET /repos/{owner}/{repo}/labels",
    permission: "Repository → Metadata: Read",
    run: (c, t) => rest(`/repos/${t.owner}/${t.repo}/labels?per_page=5`, (d) => count(d, "labels in the first page"))(c, t),
  },
  {
    id: "milestones",
    call: "GET /repos/{owner}/{repo}/milestones",
    permission: "Repository → Metadata: Read",
    run: (c, t) =>
      rest(`/repos/${t.owner}/${t.repo}/milestones?state=all&per_page=5`, (d) => count(d, "milestones in the first page"))(c, t),
  },
  {
    id: "comments",
    call: "GET /repos/{owner}/{repo}/issues/{n}/comments",
    permission: "Repository → Issues: Read",
    run: (c, t) =>
      rest(`/repos/${t.owner}/${t.repo}/issues/${t.issueNumber}/comments?per_page=5`, (d) => count(d, "comments in the first page"))(c, t),
  },
  {
    id: "rendered-body",
    call: "GET /repos/{owner}/{repo}/issues/{n} (HTML media type)",
    permission: "Repository → Issues: Read",
    run: (c, t) =>
      rest(
        `/repos/${t.owner}/${t.repo}/issues/${t.issueNumber}`,
        (d) => (typeof d?.body_html === "string" ? "body_html present" : "no body_html in the response"),
        "application/vnd.github.html+json",
      )(c, t),
  },
];

/** Every check ID, in run order. */
export const PROBE_CHECK_IDS = CHECKS.map((c) => c.id);

/** Removes the token, and anything shaped like a fine-grained PAT, from `text`. */
export function redact(text: string, token: string): string {
  let out = token ? text.split(token).join("[REDACTED]") : text;
  out = out.replace(/github_pat_[A-Za-z0-9_]+/g, "[REDACTED]");
  return out;
}

/**
 * Runs every check against `target`. Without `issueNumber` it uses the first
 * issue the `issues-since` check returns (or #1). A check that throws (a
 * network error) is recorded with status `null`, and the probe carries on.
 */
export async function runProbe(client: ReadOnlyClient, target: ProbeTarget, now = new Date()): Promise<ProbeReport> {
  const t: Required<ProbeTarget> = { ...target, issueNumber: target.issueNumber ?? 0 };
  const checks: ProbeCheck[] = [];
  let tokenExpiration: string | null = null;

  for (const def of CHECKS) {
    try {
      const { res, ok, summary } = await def.run(client, t);
      tokenExpiration ??= res.headers["github-authentication-token-expiration"] ?? null;
      const extra = res.headers["x-accepted-github-permissions"];
      checks.push({
        id: def.id,
        call: def.call,
        permission: def.permission,
        ok,
        status: res.status,
        message: ok ? summary : [errorMessage(res), extra ? `(accepted permissions: ${extra})` : ""].filter(Boolean).join(" "),
      });
      if (def.id === "issues-since" && !t.issueNumber) {
        const first = Array.isArray(res.data) ? (res.data as { number?: unknown; pull_request?: unknown }[]).find((i) => !i.pull_request) : null;
        t.issueNumber = typeof first?.number === "number" ? first.number : 1;
      }
    } catch (e) {
      if (e instanceof ProbeWriteRefused) throw e;
      checks.push({
        id: def.id,
        call: def.call,
        permission: def.permission,
        ok: false,
        status: null,
        message: `request failed: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }

  return {
    ranAt: now.toISOString(),
    target: {
      repo: `${target.owner}/${target.repo}`,
      org: target.org,
      projectNumber: target.projectNumber,
      issueNumber: t.issueNumber || null,
    },
    tokenExpiration,
    checks,
  };
}

/** A short Markdown table of the report, for reading in the terminal or an editor. */
export function formatReport(r: ProbeReport): string {
  const rows = r.checks.map(
    (c) => `| ${c.ok ? "✅" : "❌"} | ${c.id} | ${c.status ?? "—"} | ${c.permission} | ${c.message.replace(/\|/g, "\\|").replace(/\n/g, " ")} |`,
  );
  return [
    `# PAT probe — ${r.ranAt}`,
    "",
    `Repo ${r.target.repo}, org ${r.target.org}, project ${r.target.projectNumber}, issue ${r.target.issueNumber ?? "—"}.`,
    `Token expiration: ${r.tokenExpiration ?? "not sent"}.`,
    "",
    "| | Check | Status | Permission | Message |",
    "|---|---|---|---|---|",
    ...rows,
    "",
  ].join("\n");
}

/**
 * Where a report is written: `private/findings/` under `root`, which is
 * gitignored. Never a tracked path (SPEC D1).
 */
export function probeOutputPaths(root: string, ranAt: string): { dir: string; json: string; md: string } {
  const dir = `${root.replace(/\/+$/, "")}/private/findings`;
  const stamp = ranAt.replace(/[:.]/g, "-");
  return { dir, json: `${dir}/pat-probe-${stamp}.json`, md: `${dir}/pat-probe-${stamp}.md` };
}
