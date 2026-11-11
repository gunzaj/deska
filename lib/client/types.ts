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
};

/** The single-select roles (§4.1). Dimensions are keyed `dim:<fieldId>`. */
export type SingleSelectKey = "status" | "priority";
export type DimKey = `dim:${string}`;

/** A mapped dimension (§4.1): any other single-select, by field ID, with its current name. */
export type ClientDimension = {
  /** The project field's ID. */
  id: string;
  /** `dim:<fieldId>`: its key in filters, grouping, board columns and edits. */
  key: DimKey;
  name: string;
  options: ClientOption[];
  /** The field was deleted on GitHub: "Missing field — remap". */
  missing: boolean;
};

/** A mapped field as the browser sees it. */
export type ClientMappedField = { id: string; name: string; missing: boolean };

/** The field mapping (§4.1) the payload was built with. */
export type ClientMapping = {
  status: ClientMappedField | null;
  priority: ClientMappedField | null;
  /** Null: no Sprint field mapped, so sprint features are hidden. */
  sprint: ClientMappedField | null;
  /** Mapped fields the project no longer has. */
  missing: { role: string; id: string; name: string }[];
  /** Status options that also count as done (§4.5). */
  doneStatusIds: string[];
};

export type ClientMeta = {
  repo: string;
  /** The pinned project's title, when one is set (improvement 8); "" otherwise. */
  projectTitle?: string;
  viewer: string;
  writeMode: boolean;
  /** Why edit controls are off while `writeMode` is false: "Read-only token" with a connected token, else "Editing is off for this deployment". */
  editOffReason?: string;
  /** With writes on: why Close is unavailable (no Done Status chosen for close), else null (W2). */
  closeBlocked?: string | null;
  /** Create jobs GitHub has not confirmed yet (W3): shown as pending rows until the real issue arrives. */
  pendingCreates?: { id: string; title: string; status: "pending" | "sending" }[];
  demo: boolean;
  generatedAt: string;
  today: string; // YYYY-MM-DD, server clock
  /** Status in project order; Priority always lowest to highest (the mapping's setting is applied). */
  fields: Record<SingleSelectKey, ClientOption[]>;
  /** Mapped dimensions, in the mapping's order. */
  dimensions: ClientDimension[];
  mapping: ClientMapping;
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
  ip?: 1; // 1 = the issue has an item in the pinned project
  st?: string;
  pr?: string;
  /** Dimension values: field ID -> option ID. */
  dm?: Record<string, string>;
  rl?: string;
  ty?: string;
  ms?: string;
  lb?: string[];
  as?: string[]; // logins
  pa?: string; // parent node ID
  sc?: [number, number]; // GitHub's sub-issue counts: total, completed (absent = not read yet)
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
