// The token states of SPEC §3.3 and the permissions of §3.2, as plain data:
// shared by the server's check (lib/github/connection.ts) and the UI, so it
// imports nothing.

export type ConnectionState =
  /** No token stored: onboarding. */
  | "missing"
  /** 401: invalid, revoked or expired. */
  | "invalid"
  /** `GET /user` works but the org's resources are refused. */
  | "awaiting-approval"
  /** 403 "Resource not accessible by personal access token" on one permission. */
  | "missing-permission"
  /** Network error or 5xx. */
  | "offline"
  /** 403/429 with no requests left. */
  | "rate-limited"
  /** GitHub CLI source: no `gh` on the login-shell PATH. */
  | "gh-not-found"
  /** GitHub CLI source: `gh auth token` gave no token. */
  | "gh-logged-out"
  /** GitHub CLI source: the login lacks `read:project` (`project` with writes on). */
  | "missing-scope"
  | "ok"
  /** Not the desktop app (dev preview, tests): no token, sample data. */
  | "preview";

export type PermissionKey = "metadata" | "issues" | "projects" | "issueTypes";

/** The read-only permissions of SPEC §3.2. */
export const PERMISSIONS: readonly { key: PermissionKey; label: string; level: "Read"; required: boolean; usedFor: string }[] = [
  { key: "metadata", label: "Repository → Metadata", level: "Read", required: true, usedFor: "Repository info, assignable users, labels, milestones" },
  { key: "issues", label: "Repository → Issues", level: "Read", required: true, usedFor: "Issues, sub-issues, issue types on issues, comments" },
  { key: "projects", label: "Organization → Projects", level: "Read", required: true, usedFor: "Project fields, options, iterations and item values" },
  { key: "issueTypes", label: "Organization → Issue types", level: "Read", required: false, usedFor: "The org's issue types (optional: Type shows as unavailable without it)" },
];

/** "Organization → Projects: Read", as the user sees it on GitHub. */
export const permissionName = (key: PermissionKey) => {
  const p = PERMISSIONS.find((x) => x.key === key)!;
  return `${p.label}: ${p.level}`;
};

export type PermissionStatus = "granted" | "missing" | "unavailable" | "unchecked";

export type PermissionResult = {
  key: PermissionKey;
  label: string;
  level: "Read";
  required: boolean;
  status: PermissionStatus;
  /** GitHub's answer when refused (redacted), else null. */
  detail: string | null;
};

export type ConnectionStatus = {
  state: ConnectionState;
  /** Where the token comes from: a pasted token, or the GitHub CLI's login (SPEC §3.1). */
  source: "token" | "gh";
  /** The token's classic scopes (`x-oauth-scopes`); null for a fine-grained token, which has none. */
  scopes: string[] | null;
  /** A command for the user to run in a terminal (Deska never runs it), e.g. `gh auth login`. */
  command: string | null;
  /** The state's message (SPEC §3.3); null when nothing is wrong. */
  message: string | null;
  login: string | null;
  name: string | null;
  avatarUrl: string | null;
  /** From `github-authentication-token-expiration` (ISO), null when the token never expires or GitHub didn't say. */
  expiresAt: string | null;
  /** Set when the token expires within 14 days. */
  expiryWarning: string | null;
  /** Classic tokens only: set when the token's scopes allow writing (anything but read-only scopes). */
  scopeWarning: string | null;
  /** True when the token has no write permissions (SPEC §3.3; detected by a read-only check). */
  readOnly: boolean;
  readOnlyMessage: string | null;
  /** The token's write permissions (SPEC §3.4 part 1), detected without writing. */
  writeAccess: "yes" | "no" | "unknown";
  /** Why the token can't write, when it can't. */
  writeAccessMessage: string | null;
  permissions: PermissionResult[];
  /** Missing required permissions by name, e.g. "Organization → Projects: Read"; with `missing-scope`, the scopes. */
  missing: string[];
  /** ISO time the rate limit resets, when rate limited. */
  rateLimitedUntil: string | null;
  checkedAt: string;
};

export const EXPIRY_WARNING_DAYS = 14;

/** Each state's own words (SPEC §3.3). */
export const MESSAGES = {
  missing: "Connect GitHub to get started",
  invalid: "Your GitHub token is invalid or expired",
  awaitingApproval: "Your org may still need to approve this token",
  missingPermission: (names: string[]) => `This token is missing a permission: ${names.join(", ")}`,
  offline: "Can't reach GitHub",
  rateLimited: (hhmm: string) => `Rate limited until ${hhmm}`,
  expiring: (date: string) => `Your GitHub token expires on ${date}`,
  readOnly: "Read-only token",
  writeMissing: (names: string[]) => `This token can't write: missing ${names.join(", ")}`,
  writeMissingCli: (names: string[], command: string | null) =>
    `The GitHub CLI login can't write: missing ${names.join(", ")}${command ? ` — run ${command}` : ""}`,
  writeNotChecked: "Write permissions not checked yet",
  ghNotFound: "GitHub CLI isn't installed",
  ghLoggedOut: "GitHub CLI isn't logged in",
  ghMissingScope: (scopes: string[]) => `Your GitHub CLI login is missing the ${scopes.join(", ")} scope`,
  ghNotApproved: "Your org may need to approve the GitHub CLI app",
  ghCanWrite: (scopes: string[]) => `The GitHub CLI login can also write (${scopes.join(", ")}). Deska stays read-only: it writes to GitHub only when "GitHub writes" is on in Settings.`,
  writeScopes: (scopes: string[]) => `This classic token can also write (${scopes.join(", ")}). Deska only reads, but a token with only read:project is safer.`,
} as const;

/** The commands Deska shows and never runs (SPEC §3.1). */
export const GH_COMMANDS = {
  login: "gh auth login",
  addScope: (scope: string) => `gh auth refresh -h github.com -s ${scope}`,
} as const;

/** `HH:MM` in the Mac's own time zone (the server runs on it). */
export function hhmm(d: Date, timeZone?: string): string {
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone });
}
