// The local GitHub connection (SPEC §2.3, §3.3): the token the server holds in
// memory, what it can do, and whose it is. The PAT owner is the app's one
// local user (`me` in every filter).
//
// The check result is cached per token (in memory, on globalThis because Next
// loads modules more than once). The owner's login, name and avatar are kept
// in the database so the app knows who `me` is offline; the token itself never
// is.
import { inArray } from "drizzle-orm";
import { dbDir, getDb } from "@/db";
import { syncState } from "@/db/schema";
import { githubApiBase } from "./config";
import { desktopGuard } from "./desktop/guard";
import { checkToken, previewStatus, missingStatus, type CheckTarget, type ConnectionStatus } from "./github/connection";
import { localToken, tokenState } from "./github/local-token";
import { currentTarget, settingsVersion } from "./settings";

const OK_TTL_MS = 10 * 60_000;
const ERROR_TTL_MS = 60_000;

type Cache = {
  generation: number;
  /** settingsVersion() the answer was for: a newly chosen project is checked again. */
  settings?: number;
  at: number;
  status: ConnectionStatus | null;
  inflight: Promise<ConnectionStatus> | null;
};

const CACHE = Symbol.for("deska.connectionCache");

function cache(): Cache {
  const g = globalThis as Record<symbol, Cache | undefined>;
  return (g[CACHE] ??= { generation: -1, at: 0, status: null, inflight: null });
}

/** Tests only. */
export function resetConnectionCache(): void {
  (globalThis as Record<symbol, unknown>)[CACHE] = undefined;
}

/**
 * The repository and project to check against: the ones chosen in onboarding
 * step 2 (lib/settings.ts), else the env vars tests and dev set. Before either
 * exists only `GET /user` is checked and the permissions show "not checked yet".
 */
async function checkTarget(): Promise<CheckTarget | null> {
  const t = await currentTarget();
  return t ? { owner: t.owner, repo: t.repo, org: t.org, projectNumber: t.projectNumber } : null;
}

function ttl(s: ConnectionStatus): number {
  if (s.state === "rate-limited" && s.rateLimitedUntil) return Math.max(ERROR_TTL_MS, Date.parse(s.rateLimitedUntil) - Date.now());
  return s.state === "ok" || s.state === "missing-permission" ? OK_TTL_MS : ERROR_TTL_MS;
}

/** The last result for the current token, without asking GitHub. */
export function cachedConnection(): ConnectionStatus | null {
  const c = cache();
  return c.generation === tokenState().generation ? c.status : null;
}

/**
 * What the current token can do. Cached; `refresh` asks GitHub again. Outside
 * the desktop app there is no token and the answer is `preview`.
 */
export async function connectionStatus({ refresh = false }: { refresh?: boolean } = {}): Promise<ConnectionStatus> {
  if (!desktopGuard()) return previewStatus();
  const token = localToken();
  if (!token) return missingStatus();
  const c = cache();
  const { generation } = tokenState();
  const settings = settingsVersion();
  if (c.generation !== generation || c.settings !== settings) Object.assign(c, { generation, settings, at: 0, status: null, inflight: null });
  if (!refresh && c.status && Date.now() - c.at < ttl(c.status)) return c.status;
  if (c.inflight) return c.inflight;
  const run = (async () => {
    const status = await checkToken(token, await checkTarget(), { apiBase: githubApiBase() });
    // A token change while the check ran: this answer belongs to the old one.
    if (cache().generation !== generation) return status;
    Object.assign(cache(), { status, at: Date.now() });
    if (status.login) await saveIdentity(status).catch((e) => console.error(`could not save the GitHub identity: ${e instanceof Error ? e.message : String(e)}`));
    return status;
  })().finally(() => {
    if (cache().inflight === run) cache().inflight = null;
  });
  c.inflight = run;
  return run;
}

// --- identity ------------------------------------------------------------------

const IDENTITY_KEYS = { login: "github.login", name: "github.name", avatarUrl: "github.avatarUrl" } as const;

export type Identity = { login: string; name: string | null; avatarUrl: string | null };

async function saveIdentity(s: ConnectionStatus): Promise<void> {
  if (!dbDir() || !s.login) return;
  const now = new Date();
  for (const [field, key] of Object.entries(IDENTITY_KEYS) as [keyof Identity, string][]) {
    const value = s[field] ?? "";
    await getDb().insert(syncState).values({ key, value, updatedAt: now }).onConflictDoUpdate({ target: syncState.key, set: { value, updatedAt: now } });
  }
}

/** The PAT owner as last seen by a successful check, from the database. */
export async function savedIdentity(): Promise<Identity | null> {
  if (!dbDir()) return null;
  const rows = await getDb().select().from(syncState).where(inArray(syncState.key, Object.values(IDENTITY_KEYS)));
  const v = new Map(rows.map((r) => [r.key, r.value ?? ""]));
  const login = v.get(IDENTITY_KEYS.login);
  return login ? { login, name: v.get(IDENTITY_KEYS.name) || null, avatarUrl: v.get(IDENTITY_KEYS.avatarUrl) || null } : null;
}

/**
 * The app's local user: the owner of the stored token. Null without a token,
 * or when a new token's owner isn't known yet (offline, invalid). With the
 * token that was already stored at launch, the saved owner stands in while
 * GitHub can't be asked, so cached data stays usable offline.
 */
export async function localLogin(): Promise<string | null> {
  if (!localToken()) return null;
  const cached = cachedConnection();
  if (cached?.login) return cached.login;
  if (!tokenState().changedByUser) {
    const saved = await savedIdentity().catch(() => null);
    if (saved) {
      // Refresh in the background; the saved owner answers now.
      void connectionStatus().catch(() => undefined);
      return saved.login;
    }
  }
  return (await connectionStatus()).login;
}
