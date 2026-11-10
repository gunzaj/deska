// What a GitHub token can do, told apart into the states of SPEC §3.3:
// `GET /user` first (who the token belongs to, when it expires), then one
// read per permission of §3.2 against the configured repository and project.
//
// Every call goes through the probe's read-only client (REST GET and GraphQL
// queries only), so checking a token can never change anything on GitHub.
// Nothing returned here contains the token: every string GitHub sends back is
// redacted before it is kept.
import { redactSecrets } from "../redact";
import { createReadOnlyClient, type ProbeResponse, type ReadOnlyClient } from "./probe";
import {
  EXPIRY_WARNING_DAYS,
  GH_COMMANDS,
  hhmm,
  MESSAGES,
  permissionName,
  PERMISSIONS,
  type ConnectionStatus,
  type PermissionKey,
} from "./token-states";

export * from "./token-states";

/**
 * GitHub sends `2026-11-20 10:00:00 UTC` (and has sent `… +0000`). Returns
 * null for anything it can't read.
 */
export function parseExpiration(raw: string | null | undefined): Date | null {
  const v = raw?.trim();
  if (!v) return null;
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)\s*(UTC|Z|[+-]\d{2}:?\d{2})?$/.exec(v);
  if (!m) return null;
  const zone = !m[3] || m[3] === "UTC" || m[3] === "Z" ? "Z" : m[3].length === 5 ? `${m[3].slice(0, 3)}:${m[3].slice(3)}` : m[3];
  const d = new Date(`${m[1]}T${m[2]}${zone}`);
  return Number.isFinite(d.getTime()) ? d : null;
}

// --- one response ------------------------------------------------------------

type Outcome =
  | { kind: "ok"; data: unknown }
  | { kind: "invalid" }
  | { kind: "offline" }
  | { kind: "rate-limited"; until: Date }
  /** "Resource not accessible by personal access token": the permission is missing. */
  | { kind: "denied"; detail: string }
  /** An org policy refuses fine-grained tokens, or hasn't approved this one. */
  | { kind: "org-refused"; detail: string }
  /** 404 / NOT_FOUND: outside the token's reach (not selected, or not approved yet). */
  | { kind: "not-found"; detail: string };

type GqlError = { type?: string; message?: string };

function messageOf(data: unknown): string {
  if (data && typeof data === "object") {
    const d = data as { message?: unknown; errors?: GqlError[] };
    if (typeof d.message === "string") return d.message;
    if (Array.isArray(d.errors)) return d.errors.map((e) => e.message ?? e.type ?? "").filter(Boolean).join("; ");
  }
  return typeof data === "string" ? data.slice(0, 200) : "";
}

const NOT_ACCESSIBLE = /resource not accessible by (?:personal access|integration)/i;
const ORG_POLICY = /fine-grained personal access token|has not (?:yet )?approved|requires approval|forbids access|OAuth App access restrictions/i;

function rateLimitReset(res: ProbeResponse, now: Date): Date | null {
  const h = res.headers;
  const retryAfter = Number(h["retry-after"]);
  if (h["retry-after"] !== undefined && Number.isFinite(retryAfter)) return new Date(now.getTime() + retryAfter * 1000);
  if (h["x-ratelimit-remaining"] === "0") {
    const reset = Number(h["x-ratelimit-reset"]);
    return Number.isFinite(reset) && reset > 0 ? new Date(reset * 1000) : new Date(now.getTime() + 60_000);
  }
  return null;
}

/** Scopes of a classic token (`x-oauth-scopes`) that are not read-only. Fine-grained tokens send no such header. */
const READ_ONLY_SCOPES = /^(?:read:[a-z_]+|user:email|user:follow|repo:status|repo_deployment|public_repo)$/;
export function writeScopesWarning(header: string | null | undefined, source: "token" | "gh" = "token"): string | null {
  const writes = (parseScopes(header) ?? []).filter((x) => !READ_ONLY_SCOPES.test(x));
  if (!writes.length) return null;
  return source === "gh" ? MESSAGES.ghCanWrite(writes) : MESSAGES.writeScopes(writes);
}

/** `x-oauth-scopes` as a list; null when GitHub sent none (a fine-grained token). */
export function parseScopes(header: string | null | undefined): string[] | null {
  if (header === null || header === undefined || !header.trim()) return null;
  return header.split(",").map((x) => x.trim()).filter(Boolean);
}

/**
 * The project scope a GitHub CLI login lacks (SPEC §3.1): `read:project`, or
 * `project` once writes are on (`project` covers reading too). Null when it is
 * there, or when the token has no classic scopes to read.
 */
export function missingProjectScope(scopes: string[] | null, writes: boolean): string | null {
  if (!scopes) return null;
  if (scopes.includes("project")) return null;
  return writes ? "project" : scopes.includes("read:project") ? null : "read:project";
}

/** Classic scopes that let a token write issues: `repo` covers all repositories, `public_repo` public ones. */
const ISSUE_WRITE_SCOPES = new Set(["repo", "public_repo"]);

/**
 * The write permissions of a classic token or a GitHub CLI login, from its
 * scopes (SPEC §3.1). `project` is the write scope for project fields;
 * `read:project` only reads. The message names what is missing.
 */
export function classicWriteAccess(scopes: string[], source: "token" | "gh"): Pick<ConnectionStatus, "writeAccess" | "writeAccessMessage"> {
  const issues = scopes.some((s) => ISSUE_WRITE_SCOPES.has(s));
  const projects = scopes.includes("project");
  if (issues && projects) return { writeAccess: "yes", writeAccessMessage: null };
  const missing = [...(issues ? [] : ["Repository → Issues: Read and write"]), ...(projects ? [] : ["Organization → Projects: Read and write"])];
  return {
    writeAccess: "no",
    writeAccessMessage: source === "gh" ? MESSAGES.writeMissingCli(missing, GH_COMMANDS.addScope("project")) : MESSAGES.writeMissing(missing),
  };
}

/** One read-only check of a fine-grained token's write permissions (never a write). */
const WRITE_CHECK_QUERY = `query DeskaWriteCheck($owner: String!, $name: String!, $org: String!, $num: Int!) {
  repository(owner: $owner, name: $name) {
    issues(first: 1, states: OPEN) {
      nodes { viewerCanUpdate viewerCanLabel viewerCanAssign viewerCanClose }
    }
  }
  organization: repositoryOwner(login: $org) { ... on ProjectV2Owner { projectV2(number: $num) { viewerCanUpdate } } }
}`;

type WriteCheckData = {
  data?: {
    repository?: { issues?: { nodes?: { viewerCanUpdate?: boolean; viewerCanLabel?: boolean; viewerCanAssign?: boolean; viewerCanClose?: boolean }[] } | null } | null;
    organization?: { projectV2?: { viewerCanUpdate?: boolean } | null } | null;
  } | null;
};

/**
 * The write permissions of a fine-grained token, from GitHub's `viewerCan*`
 * fields (SPEC §3.3, W0's detection). `unknown` when the answer can't be read:
 * a transient failure must not turn writes off for a token that can write.
 */
export function writeAccessFrom(outcome: Outcome, source: "token" | "gh"): Pick<ConnectionStatus, "writeAccess" | "writeAccessMessage"> {
  if (outcome.kind !== "ok") return { writeAccess: "unknown", writeAccessMessage: null };
  const data = (outcome.data as WriteCheckData)?.data;
  const issue = data?.repository?.issues?.nodes?.[0];
  const project = data?.organization?.projectV2;
  const issues = issue ? Boolean(issue.viewerCanUpdate && issue.viewerCanLabel && issue.viewerCanAssign && issue.viewerCanClose) : null;
  const projects = project ? project.viewerCanUpdate === true : null;
  if (issues === true && projects === true) return { writeAccess: "yes", writeAccessMessage: null };
  if (issues === null || projects === null) return { writeAccess: "unknown", writeAccessMessage: null };
  const missing = [...(issues ? [] : ["Repository → Issues: Read and write"]), ...(projects ? [] : ["Organization → Projects: Read and write"])];
  return {
    writeAccess: "no",
    writeAccessMessage: source === "gh" ? MESSAGES.writeMissingCli(missing, GH_COMMANDS.addScope("project")) : MESSAGES.writeMissing(missing),
  };
}

/** One response, classified. Exported for tests. */
export function classify(res: ProbeResponse, now: Date): Outcome {
  const detail = redactSecrets(messageOf(res.data)).slice(0, 300);
  if (res.status === 401) return { kind: "invalid" };
  if (res.status === 403 || res.status === 429) {
    const until = rateLimitReset(res, now);
    if (until || res.status === 429) return { kind: "rate-limited", until: until ?? new Date(now.getTime() + 60_000) };
  }
  if (res.status >= 500) return { kind: "offline" };
  if (res.status === 403 || res.status === 422) {
    if (ORG_POLICY.test(detail)) return { kind: "org-refused", detail };
    return { kind: "denied", detail };
  }
  if (res.status === 404) return { kind: "not-found", detail };
  if (res.status >= 400) return { kind: "denied", detail };
  // GraphQL answers 200 with `errors`.
  const errors = (res.data as { errors?: GqlError[] } | null)?.errors;
  if (Array.isArray(errors) && errors.length) {
    if (errors.some((e) => e.type === "RATE_LIMITED")) return { kind: "rate-limited", until: rateLimitReset(res, now) ?? new Date(now.getTime() + 60_000) };
    if (errors.some((e) => ORG_POLICY.test(e.message ?? ""))) return { kind: "org-refused", detail };
    if (errors.some((e) => e.type === "FORBIDDEN" || NOT_ACCESSIBLE.test(e.message ?? ""))) return { kind: "denied", detail };
    if (errors.some((e) => e.type === "NOT_FOUND")) return { kind: "not-found", detail };
    return { kind: "denied", detail };
  }
  return { kind: "ok", data: res.data };
}

async function call(fn: () => Promise<ProbeResponse>, now: Date): Promise<{ outcome: Outcome; res: ProbeResponse | null }> {
  try {
    const res = await fn();
    return { outcome: classify(res, now), res };
  } catch {
    // A network error or timeout. The error text may carry the URL; nothing of it is kept.
    return { outcome: { kind: "offline" }, res: null };
  }
}

// --- the whole check -----------------------------------------------------------

export type CheckTarget = { owner: string; repo: string; org: string; projectNumber: number };

export type CheckOptions = {
  fetch?: typeof fetch;
  apiBase?: string;
  now?: Date;
  /** For tests: the zone `Rate limited until HH:MM` is written in. */
  timeZone?: string;
  /** Tests: a client to use instead of building one. */
  client?: ReadOnlyClient;
  /** Where the token comes from; "gh" checks the login's scopes and words the states for the GitHub CLI. */
  source?: "token" | "gh";
  /** GitHub writes are on (SPEC §3.4): a GitHub CLI login then needs `project`, not just `read:project`. */
  writes?: boolean;
};

const PROJECT_QUERY = `query DeskaProjectCheck($org: String!, $number: Int!) {
  organization: repositoryOwner(login: $org) { ... on ProjectV2Owner { projectV2(number: $number) { id } } }
}`;

const ISSUE_TYPES_QUERY = `query DeskaIssueTypesCheck($org: String!) {
  organization: repositoryOwner(login: $org) { ... on Organization { issueTypes(first: 1) { totalCount } } }
}`;

function base(now: Date, source: "token" | "gh" = "token"): ConnectionStatus {
  return {
    state: "ok",
    source,
    scopes: null,
    command: null,
    message: null,
    login: null,
    name: null,
    avatarUrl: null,
    expiresAt: null,
    expiryWarning: null,
    scopeWarning: null,
    readOnly: false,
    readOnlyMessage: null,
    writeAccess: "unknown",
    writeAccessMessage: null,
    permissions: PERMISSIONS.map((p) => ({ key: p.key, label: p.label, level: p.level, required: p.required, status: "unchecked", detail: null })),
    missing: [],
    rateLimitedUntil: null,
    checkedAt: now.toISOString(),
  };
}

/** The status for "no token stored". */
export function missingStatus(now = new Date()): ConnectionStatus {
  return { ...base(now), state: "missing", message: MESSAGES.missing };
}

/** The GitHub CLI source without a token: `gh` is missing, or it is logged out (SPEC §3.3). */
export function ghCliStatus(cli: "not-found" | "logged-out", now = new Date()): ConnectionStatus {
  return cli === "not-found"
    ? { ...base(now, "gh"), state: "gh-not-found", message: MESSAGES.ghNotFound, command: GH_COMMANDS.login }
    : { ...base(now, "gh"), state: "gh-logged-out", message: MESSAGES.ghLoggedOut, command: GH_COMMANDS.login };
}

/** The status outside the desktop app: no token, nothing to report. */
export function previewStatus(now = new Date()): ConnectionStatus {
  return { ...base(now), state: "preview" };
}

function withState(s: ConnectionStatus, outcome: Extract<Outcome, { kind: "invalid" | "offline" | "rate-limited" }>, timeZone?: string): ConnectionStatus {
  if (outcome.kind === "invalid") return { ...s, state: "invalid", message: MESSAGES.invalid };
  if (outcome.kind === "offline") return { ...s, state: "offline", message: MESSAGES.offline };
  return { ...s, state: "rate-limited", message: MESSAGES.rateLimited(hhmm(outcome.until, timeZone)), rateLimitedUntil: outcome.until.toISOString() };
}

/**
 * Check a token: `GET /user`, then (with a target) one read per permission.
 * Never throws; never returns the token.
 */
export async function checkToken(token: string | null, target: CheckTarget | null, opts: CheckOptions = {}): Promise<ConnectionStatus> {
  const now = opts.now ?? new Date();
  const source = opts.source ?? "token";
  if (!token) return missingStatus(now);
  const client = opts.client ?? createReadOnlyClient(token, opts.fetch ?? fetch, { apiBase: opts.apiBase, userAgent: "deska", timeoutMs: 15_000 });
  let s = base(now, source);

  const user = await call(() => client.rest("GET", "/user"), now);
  if (user.outcome.kind === "invalid" || user.outcome.kind === "offline" || user.outcome.kind === "rate-limited") return withState(s, user.outcome, opts.timeZone);
  if (user.outcome.kind !== "ok") {
    // `GET /user` itself refused: nothing works with this token.
    return { ...s, state: "invalid", message: MESSAGES.invalid };
  }
  const u = user.outcome.data as { login?: unknown; name?: unknown; avatar_url?: unknown } | null;
  if (typeof u?.login !== "string" || !u.login) return { ...s, state: "offline", message: MESSAGES.offline };
  const expires = parseExpiration(user.res?.headers["github-authentication-token-expiration"]);
  const scopes = parseScopes(user.res?.headers["x-oauth-scopes"]);
  s = {
    ...s,
    login: u.login,
    name: typeof u.name === "string" ? u.name : null,
    avatarUrl: typeof u.avatar_url === "string" ? u.avatar_url : null,
    expiresAt: expires?.toISOString() ?? null,
    expiryWarning:
      expires && expires.getTime() - now.getTime() < EXPIRY_WARNING_DAYS * 86_400_000 ? MESSAGES.expiring(expires.toISOString().slice(0, 10)) : null,
    scopes,
    scopeWarning: writeScopesWarning(user.res?.headers["x-oauth-scopes"], source),
  };
  // SPEC §3.3/§3.4: can the token write? A classic or GitHub CLI token
  // says so in its scopes. A fine-grained token has no scopes, so GitHub is
  // asked with read-only `viewerCan*` fields (never a write attempt).
  if (scopes) {
    s = { ...s, ...classicWriteAccess(scopes, source) };
  } else if (target) {
    const write = await call(() => client.graphql(WRITE_CHECK_QUERY, { owner: target.owner, name: target.repo, org: target.org, num: target.projectNumber }), now);
    s = { ...s, ...writeAccessFrom(write.outcome, source) };
  }
  // A GitHub CLI login without the project scope can't read any project:
  // name the scope and the command, before any project read fails less clearly.
  const scope = source === "gh" ? missingProjectScope(scopes, opts.writes === true) : null;
  if (scope) return { ...s, state: "missing-scope", message: MESSAGES.ghMissingScope([scope]), missing: [scope], command: GH_COMMANDS.addScope(scope) };
  if (!target) return s;

  const { owner, repo, org, projectNumber } = target;
  const repoPath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const [metadata, issues, projects, issueTypes] = await Promise.all([
    call(() => client.rest("GET", repoPath), now),
    call(() => client.rest("GET", `${repoPath}/issues?per_page=1&state=all`), now),
    call(() => client.graphql(PROJECT_QUERY, { org, number: projectNumber }), now),
    call(() => client.graphql(ISSUE_TYPES_QUERY, { org }), now),
  ]);
  const outcomes: Record<PermissionKey, Outcome> = {
    metadata: metadata.outcome,
    issues: issues.outcome,
    projects: projects.outcome,
    issueTypes: issueTypes.outcome,
  };
  // A project number the org doesn't have answers `projectV2: null`.
  if (projects.outcome.kind === "ok") {
    const p = (projects.outcome.data as { data?: { organization?: { projectV2?: unknown } | null } } | null)?.data?.organization?.projectV2;
    if (!p) outcomes.projects = { kind: "not-found", detail: `No project ${projectNumber} visible in ${org}` };
  }

  s = {
    ...s,
    permissions: s.permissions.map((p) => {
      const o = outcomes[p.key];
      if (o.kind === "ok") return { ...p, status: "granted" };
      if (o.kind === "denied" || o.kind === "not-found" || o.kind === "org-refused") return { ...p, status: p.required ? "missing" : "unavailable", detail: o.detail };
      return p;
    }),
  };

  // The read-only state of SPEC §3.3 is the write detection of §3.4: the
  // short message is "Read-only token"; the detail names the permission.
  s = { ...s, readOnly: s.writeAccess === "no", readOnlyMessage: s.writeAccess === "no" ? MESSAGES.readOnly : null };
  const all = Object.values(outcomes);
  const first = <K extends Outcome["kind"]>(kind: K) => all.find((o): o is Extract<Outcome, { kind: K }> => o.kind === kind);
  const hard = first("invalid") ?? first("rate-limited") ?? first("offline");
  if (hard) return withState(s, hard, opts.timeZone);

  // Org resources refused while `GET /user` works: the token waits for the
  // org's approval (or an org policy refuses it). Private repo and project
  // both out of reach, or an explicit policy answer.
  const required = (["metadata", "issues", "projects"] as const).map((k) => outcomes[k]);
  const outOfReach = (o: Outcome) => o.kind === "not-found" || o.kind === "org-refused";
  if (required.some((o) => o.kind === "org-refused") || (outOfReach(outcomes.metadata) && outcomes.projects.kind !== "ok")) {
    return { ...s, state: "awaiting-approval", message: source === "gh" ? MESSAGES.ghNotApproved : MESSAGES.awaitingApproval };
  }

  const missing = PERMISSIONS.filter((p) => p.required && outcomes[p.key].kind !== "ok").map((p) => permissionName(p.key));
  if (missing.length) return { ...s, state: "missing-permission", message: MESSAGES.missingPermission(missing), missing };
  return s;
}
