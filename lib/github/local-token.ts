// The GitHub token as the local server holds it (SPEC §2.3). The Electron main
// process decrypts the stored token and sends it over IPC; the server entry
// (desktop/server-entry.ts) keeps it on `globalThis`, in memory only. Nothing
// here reads an environment variable, a file or the database.
//
// globalThis, not a module variable: Next loads server modules more than
// once, and every copy must see the same token.
import { noteTokenChange } from "../writes/token-change";

const TOKEN = Symbol.for("deska.githubToken");
const STATE = Symbol.for("deska.githubTokenState");
const AUTH = Symbol.for("deska.githubTokenAuth");
const WAITERS = Symbol.for("deska.githubTokenWaiters");
// desktop/server-entry.ts: the channel to the main process.
const MAIN = Symbol.for("deska.mainChannel");

/**
 * Where the token comes from (SPEC §2.3): a token main stores encrypted, or
 * the GitHub CLI's login, read by main with `gh auth token` and never stored.
 * With the CLI source a missing token has a reason: `cli`.
 */
export type TokenAuth = { source: "token" } | { source: "gh"; cli: "ok" | "not-found" | "logged-out" };

/** Written by desktop/server-entry.ts on every token message. */
export type TokenState = {
  /** Bumped on every token message; a cached check belongs to one generation. */
  generation: number;
  /** True once the user set or cleared the token in this run (not just the launch hand-over). */
  changedByUser: boolean;
  /** This token is main's answer to a `gh-reread`: a 401 on it is final. */
  afterReread: boolean;
};

type Holder = Record<symbol, unknown>;

/** The token, or null when none is stored (or outside the desktop app). */
export function localToken(): string | null {
  const t = (globalThis as Holder)[TOKEN];
  return typeof t === "string" && t ? t : null;
}

export function tokenState(): TokenState {
  const s = (globalThis as Holder)[STATE] as Partial<TokenState> | undefined;
  return { generation: s?.generation ?? 0, changedByUser: s?.changedByUser ?? false, afterReread: s?.afterReread ?? false };
}

/** What desktop/server-entry.ts does with a token message; tests use it too. */
export function setLocalToken(token: string | null, source: "launch" | "user", auth: TokenAuth = { source: "token" }, reread = false): void {
  const g = globalThis as Holder;
  const prev = tokenState();
  g[TOKEN] = token ?? undefined;
  g[AUTH] = auth;
  g[STATE] = { generation: prev.generation + 1, changedByUser: prev.changedByUser || source === "user", afterReread: reread } satisfies TokenState;
  // A token change turns "GitHub writes" off (SPEC §3.4); the gate applies it.
  if (source === "user") noteTokenChange();
  const waiters = g[WAITERS] as Set<() => void> | undefined;
  g[WAITERS] = undefined;
  for (const w of waiters ?? []) w();
}

/** Where the current token (or its absence) comes from. */
export function tokenAuth(): TokenAuth {
  const a = (globalThis as Holder)[AUTH] as TokenAuth | undefined;
  return a?.source === "gh" ? a : { source: "token" };
}

const REREAD_WAIT_MS = 15_000;

/**
 * GitHub answered 401 to the GitHub CLI's token: ask main to read it again
 * (`gh auth token`), once per token (SPEC §2.3). Resolves true when main's
 * answer has arrived (it may be the same token, a new one, or none), false
 * when this token already is such an answer, the source isn't the CLI, or
 * there is no main process to ask.
 */
export function requestGhReread(waitMs = REREAD_WAIT_MS): Promise<boolean> {
  const g = globalThis as Holder;
  const send = g[MAIN] as ((msg: { type: "gh-reread" }) => void) | undefined;
  if (tokenAuth().source !== "gh" || tokenState().afterReread || typeof send !== "function") return Promise.resolve(false);
  return new Promise<boolean>((resolve) => {
    const waiters = ((g[WAITERS] as Set<() => void> | undefined) ?? (g[WAITERS] = new Set<() => void>())) as Set<() => void>;
    const first = waiters.size === 0;
    const done = () => {
      clearTimeout(timer);
      resolve(true);
    };
    const timer = setTimeout(() => {
      waiters.delete(done);
      resolve(false);
    }, waitMs);
    waiters.add(done);
    // One question per token, however many callers wait for the answer.
    if (first) send({ type: "gh-reread" });
  });
}
