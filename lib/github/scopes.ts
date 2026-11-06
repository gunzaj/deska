/**
 * OAuth scopes to request at sign-in (SPEC §6).
 *
 * In read-only mode (`WRITE_MODE` is not `"on"`, the default) we ask only for
 * read scopes, so GitHub itself refuses every write — the app cannot change a
 * ticket even if a code path tried to. `public_repo` and `project` are write
 * scopes and are added only when writes are explicitly enabled, which needs
 * IT/security sign-off.
 *
 * That holds for tokens issued while writes were off. A token issued earlier,
 * under `WRITE_MODE=on`, keeps its write scopes, and GitHub may hand back
 * scopes a user granted before (it merges them). So the session records the
 * mode it was issued under and a session from the other mode is sent back to
 * sign in again (v5 2.8); the database only stores tokens while writes are on.
 */
export function requestedScopes(writeMode: string | undefined): string {
  return writeMode === "on"
    ? "read:user read:org public_repo project"
    : "read:user read:org read:project";
}

/** The mode a token was issued under, as recorded in the session. */
export type ScopeMode = "on" | "off";

export function scopeModeOf(writeMode: string | undefined): ScopeMode {
  return writeMode === "on" ? "on" : "off";
}

/**
 * Whether a session was issued under the current `WRITE_MODE`. A session with
 * no record (signed in before this was tracked) counts as read-only, which is
 * what every deployment issued tokens for until writes were enabled.
 */
export function scopeMatchesMode(token: { scopeMode?: unknown } | null | undefined, writeMode: string | undefined): boolean {
  const issued: ScopeMode = token?.scopeMode === "on" ? "on" : "off";
  return issued === scopeModeOf(writeMode);
}
