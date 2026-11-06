// The GitHub token as the local server holds it (SPEC §2.3). The Electron main
// process decrypts the stored token and sends it over IPC; the server entry
// (desktop/server-entry.ts) keeps it on `globalThis`, in memory only. Nothing
// here reads an environment variable, a file or the database.
//
// globalThis, not a module variable: Next loads server modules more than
// once, and every copy must see the same token.

const TOKEN = Symbol.for("deska.githubToken");
const STATE = Symbol.for("deska.githubTokenState");

/** Written by desktop/server-entry.ts on every token message. */
export type TokenState = {
  /** Bumped on every token message; a cached check belongs to one generation. */
  generation: number;
  /** True once the user set or cleared the token in this run (not just the launch hand-over). */
  changedByUser: boolean;
};

type Holder = Record<symbol, unknown>;

/** The token, or null when none is stored (or outside the desktop app). */
export function localToken(): string | null {
  const t = (globalThis as Holder)[TOKEN];
  return typeof t === "string" && t ? t : null;
}

export function tokenState(): TokenState {
  const s = (globalThis as Holder)[STATE] as Partial<TokenState> | undefined;
  return { generation: s?.generation ?? 0, changedByUser: s?.changedByUser ?? false };
}

/** What desktop/server-entry.ts does with a token message; tests use it too. */
export function setLocalToken(token: string | null, source: "launch" | "user"): void {
  const prev = tokenState();
  (globalThis as Holder)[TOKEN] = token ?? undefined;
  (globalThis as Holder)[STATE] = { generation: prev.generation + 1, changedByUser: prev.changedByUser || source === "user" } satisfies TokenState;
}
