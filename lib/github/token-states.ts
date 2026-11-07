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
  /** True when the token has no write permissions (every token until writes land, Phase C). */
  readOnly: boolean;
  readOnlyMessage: string | null;
  permissions: PermissionResult[];
  /** Missing required permissions by name, e.g. "Organization → Projects: Read". */
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
  writeScopes: (scopes: string[]) => `This classic token can also write (${scopes.join(", ")}). Deska only reads, but a token with only read:project is safer.`,
} as const;

/** `HH:MM` in the Mac's own time zone (the server runs on it). */
export function hhmm(d: Date, timeZone?: string): string {
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone });
}
