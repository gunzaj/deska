// Shapes shipped to the browser. Framework-free and server-import-free so both
// sides can use them. Issue rows are compact (no body): bodies and comments
// are fetched on demand when an issue is opened.
import type { ViewRow } from "../views/rows";

export type ClientOption = { id: string; name: string; color: string; position: number };

export type ClientRelease = {
  id: string;
  title: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // exclusive, YYYY-MM-DD
  duration: number;
};

export type ClientIssue = ViewRow & {
  url: string;
  authorLogin: string;
  closedAt: string | null;
  stateReason: string | null;
  /** Sub-issue counts (only those in the cache). */
  subTotal: number;
  subClosed: number;
};

export type SingleSelectKey = "status" | "priority" | "team" | "platform";

export type ClientMeta = {
  repo: string;
  viewer: string;
  writeMode: boolean;
  /** Why edit controls are off while `writeMode` is false: "Read-only token" with a connected token, else "Editing is off for this deployment". */
  editOffReason?: string;
  /** With writes on: why Close is unavailable (STATUS_DONE_OPTION_ID missing or unknown), else null (W1). */
  closeBlocked?: string | null;
  demo: boolean;
  generatedAt: string;
  today: string; // YYYY-MM-DD, server clock
  fields: Record<SingleSelectKey, ClientOption[]>;
  releases: ClientRelease[]; // ascending by start date
  currentReleaseId: string | null;
  nextReleaseId: string | null;
  previousReleaseId: string | null;
  issueTypes: { id: string; name: string; color: string }[];
  labels: { id: string; name: string; color: string }[];
  milestones: { id: string; title: string; state: string; dueOn: string | null }[];
  users: { login: string; avatarUrl: string | null }[];
};

export type ClientData = { meta: ClientMeta; issues: ClientIssue[] };

/**
 * Compact transport row (~4x smaller than ClientIssue). Names, ranks, parent
 * titles and sub-issue counts are rebuilt in the browser from `meta`.
 */
export type WireIssue = {
  id: string; // node ID
  n: number;
  t: string;
  o: 0 | 1; // 1 = open
  sr?: string; // state reason
  st?: string;
  pr?: string;
  tm?: string;
  pl?: string;
  rl?: string;
  ty?: string;
  ms?: string;
  lb?: string[];
  as?: string[]; // logins
  pa?: string; // parent node ID
  au: string;
  c: string;
  u: string;
  cl?: string;
  /** Canonical GitHub URL, sent only when it is not `${meta.repo}/issues/${n}`. */
  gh?: string;
};

export type WireData = { meta: ClientMeta; issues: WireIssue[] };

/** Full issue detail fetched when an issue is opened. */
export type IssueComment = {
  id: string;
  author: string;
  avatarUrl: string | null;
  createdAt: string;
  bodyHtml: string | null;
  body: string;
  url: string;
};

export type IssueDetail = {
  number: number;
  bodyHtml: string | null;
  body: string;
  comments: IssueComment[];
  commentsError: string | null;
  source: "github" | "cache" | "demo";
};

/** A pull request as the PR lens shows it (SPEC §13.3). No body: fetched on open. */
export type ClientPr = {
  nodeId: string;
  number: number;
  title: string;
  state: "open" | "closed" | "merged";
  isDraft: boolean;
  author: string;
  url: string;
  headRef: string;
  baseRef: string;
  reviewDecision: string | null;
  checksState: string | null;
  milestoneId: string | null;
  additions: number;
  deletions: number;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  mergedAt: string | null;
  labelIds: string[];
  assignees: string[];
  reviewRequests: { kind: "user" | "team"; reviewer: string }[];
  reviews: { author: string; state: string; submittedAt: string | null }[];
  /** Node IDs of issues in this repo the PR closes. */
  closingIssues: string[];
};

export type PrData = { prs: ClientPr[]; /** Slugs of teams the viewer is in. */ myTeams: string[] };
