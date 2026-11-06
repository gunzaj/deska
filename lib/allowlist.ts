// Edge-safe allowlist helpers (no Node APIs — usable in middleware).
export function parseAllowlist(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function isAllowedLogin(
  login: string | null | undefined,
  rawAllowlist?: string,
): boolean {
  if (!login) return false;
  const list = parseAllowlist(
    rawAllowlist ?? process.env.ALLOWED_GITHUB_LOGINS,
  );
  if (list.length === 0) return false;
  return list.includes(login.toLowerCase());
}

// --- Org access (SPEC §14) -------------------------------------------------------

export type AccessMode = "allowlist" | "org";

/** `allowlist` (default) or `org`: any active member of the GitHub org. */
export function accessMode(raw = process.env.ACCESS_MODE): AccessMode {
  return raw?.trim() === "org" ? "org" : "allowlist";
}

export function recheckMs(raw = process.env.ACCESS_RECHECK_HOURS): number {
  const h = Number(raw ?? 24);
  return (Number.isFinite(h) && h > 0 ? h : 24) * 3600_000;
}

export type AccessDecision = "allow" | "recheck" | "deny";

/**
 * Who gets in. The allowlist always works (also as an extra allow in org mode,
 * e.g. for an outside collaborator). In org mode an active membership,
 * checked within the recheck window, lets a user in; a stale or missing check
 * asks for a recheck; a check that said "not a member" denies.
 */
export function decideAccess(i: {
  login: string | null | undefined;
  orgActive?: boolean;
  orgCheckedAt?: number;
  now?: number;
  mode?: AccessMode;
  allowlist?: string;
  recheck?: number;
}): AccessDecision {
  if (!i.login) return "deny";
  if (isAllowedLogin(i.login, i.allowlist)) return "allow";
  if ((i.mode ?? accessMode()) !== "org") return "deny";
  if (i.orgCheckedAt == null) return "recheck";
  if (!i.orgActive) return "deny";
  return (i.now ?? Date.now()) - i.orgCheckedAt < (i.recheck ?? recheckMs()) ? "allow" : "recheck";
}

/**
 * Whether a login could sign in, for "can't sign in to Deska" hints. In org
 * mode membership is only known at sign-in, so repo assignees count as able.
 */
export function canSignIn(login: string, mode = accessMode()): boolean {
  return mode === "org" || isAllowedLogin(login);
}
