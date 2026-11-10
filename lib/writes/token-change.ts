// SPEC §3.4 part 2: "GitHub writes" turns off on every token change (replace
// token, disconnect, switch to the GitHub CLI login). The token holders set a
// flag; the gate applies it on its next read. This module has no imports, so
// lib/github/local-token.ts and lib/writes/gate.ts can both use it without a
// cycle. `desktop/server-entry.ts` is compiled apart from lib/ and sets the same
// `Symbol.for` slot.
const TOKEN_CHANGED = Symbol.for("deska.writesTokenChanged");

/** Called by the token holders on a user-initiated token change. */
export function noteTokenChange(): void {
  (globalThis as Record<symbol, unknown>)[TOKEN_CHANGED] = true;
}

/** Take the pending token-change flag, if any. */
export function takeTokenChange(): boolean {
  const g = globalThis as Record<symbol, unknown>;
  if (!g[TOKEN_CHANGED]) return false;
  g[TOKEN_CHANGED] = undefined;
  return true;
}
