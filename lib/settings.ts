// Local, non-secret settings (SPEC §2.4): the GitHub target Deska reads
// (repository, org, project number and its pinned node ID) and the field
// mapping (§4.1). In the `app_settings` table with a database; in memory
// without one (the dev preview and mocked e2e). Never the token.
//
// Kept on globalThis because Next loads server modules more than once, and a
// save must be seen by every copy.
import { inArray } from "drizzle-orm";
import { dbDir, getDb } from "@/db";
import { appSettings } from "@/db/schema";
import { ConfigError, displayRepo, githubTarget, type GithubTarget } from "./config";
import { parseAiSettings, type AiSettings } from "./ai/types";
import { parseMapping, type FieldMapping } from "./sync/field-map";

/** The repository and project chosen in onboarding step 2. */
export type StoredTarget = {
  /** `owner/repo`. */
  repo: string;
  org: string;
  projectNumber: number;
  /** The project's node ID, pinned when it was picked (§3.2). */
  projectId: string;
  projectTitle: string;
};

const KEYS = {
  target: "github.target",
  mapping: "project.mapping",
  tasksOnly: "app.tasks-only",
  writes: "github.writes",
  writeAccess: "github.write-access",
  closeDoneStatus: "project.close-done-status",
  ai: "ai.settings",
  aiVerified: "ai.verified",
  aiEndpointModes: "ai.endpoint-modes",
  theme: "ui.theme",
} as const;

type Cache = { loaded: Promise<void> | null; values: Map<string, unknown>; version: number };
const CACHE = Symbol.for("deska.settings");

function cache(): Cache {
  const g = globalThis as Record<symbol, Cache | undefined>;
  return (g[CACHE] ??= { loaded: null, values: new Map(), version: 0 });
}

/** Tests only: forget everything (and, without a database, the stored values). */
export function resetSettingsCache(): void {
  (globalThis as Record<symbol, unknown>)[CACHE] = undefined;
}

async function load(): Promise<void> {
  const c = cache();
  if (!dbDir()) return;
  c.loaded ??= (async () => {
    const rows = await getDb().select().from(appSettings).where(inArray(appSettings.key, Object.values(KEYS)));
    for (const r of rows) c.values.set(r.key, r.value);
  })().catch((e: unknown) => {
    c.loaded = null;
    throw e;
  });
  await c.loaded;
}

async function get(key: string): Promise<unknown> {
  await load();
  return cache().values.get(key) ?? null;
}

async function set(key: string, value: unknown): Promise<void> {
  await load();
  if (dbDir()) {
    const now = new Date();
    await getDb()
      .insert(appSettings)
      .values({ key, value, updatedAt: now })
      .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: now } });
  }
  const c = cache();
  c.values.set(key, value);
  c.version += 1;
}

/**
 * Save only when the value changed. The connection check re-reads the token's
 * capabilities every few minutes; without this every check bumped the settings
 * version and with it the data ETag, so every client reloaded its data for nothing.
 */
async function setIfChanged(key: string, value: unknown): Promise<void> {
  await load();
  if (JSON.stringify(cache().values.get(key) ?? null) === JSON.stringify(value)) return;
  await set(key, value);
}

/**
 * A cosmetic setting (ADR-001): stored like any other, but it does not bump
 * `settingsVersion()`, so a theme change never refetches the data or re-checks
 * the connection.
 */
async function setCosmetic(key: string, value: unknown): Promise<void> {
  await load();
  if (dbDir()) {
    const now = new Date();
    await getDb()
      .insert(appSettings)
      .values({ key, value, updatedAt: now })
      .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: now } });
  }
  cache().values.set(key, value);
}

export type Theme = "system" | "light" | "dark";

/** The colour theme (ADR-001). Kept in the database because the window's origin changes on every launch, which empties `localStorage`. Any read error is "system". */
export async function readTheme(): Promise<Theme> {
  try {
    const v = await get(KEYS.theme);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

export async function saveTheme(theme: Theme): Promise<void> {
  await setCosmetic(KEYS.theme, theme);
}

/** Bumped by every save: part of the data ETag, so a remap reaches the browser. */
export function settingsVersion(): number {
  return cache().version;
}

function parseTarget(v: unknown): StoredTarget | null {
  if (!v || typeof v !== "object") return null;
  const t = v as Partial<StoredTarget>;
  if (typeof t.repo !== "string" || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(t.repo)) return null;
  if (typeof t.org !== "string" || !t.org || typeof t.projectNumber !== "number" || typeof t.projectId !== "string") return null;
  return { repo: t.repo, org: t.org, projectNumber: t.projectNumber, projectId: t.projectId, projectTitle: typeof t.projectTitle === "string" ? t.projectTitle : "" };
}

export async function readTarget(): Promise<StoredTarget | null> {
  return parseTarget(await get(KEYS.target));
}

export async function saveTarget(t: StoredTarget): Promise<void> {
  await set(KEYS.target, t);
}

export async function readMapping(): Promise<FieldMapping | null> {
  return parseMapping(await get(KEYS.mapping));
}

export async function saveMapping(m: FieldMapping): Promise<void> {
  await set(KEYS.mapping, m);
}

/** The user skipped the GitHub setup and uses Deska for tasks only. */
export async function readTasksOnly(): Promise<boolean> {
  return (await get(KEYS.tasksOnly)) === true;
}

export async function saveTasksOnly(on: boolean): Promise<void> {
  await set(KEYS.tasksOnly, on);
}

/** Settings → "GitHub writes" (SPEC §3.4, part 2). Off by default and after every token change. */
export async function readWrites(): Promise<boolean> {
  return (await get(KEYS.writes)) === true;
}

export async function saveWrites(on: boolean): Promise<void> {
  await setIfChanged(KEYS.writes, on);
}

/**
 * What the token's write permissions were found to be (SPEC §3.3), detected with
 * read-only queries and stored so the gate survives a relaunch. `unknown` until
 * the check has run for the current token.
 */
export type StoredWriteAccess = { state: "yes" | "no" | "unknown"; message: string | null; checkedAt: string | null };

const NO_WRITE_ACCESS: StoredWriteAccess = { state: "unknown", message: null, checkedAt: null };

export async function readWriteAccess(): Promise<StoredWriteAccess> {
  const v = await get(KEYS.writeAccess);
  if (!v || typeof v !== "object") return NO_WRITE_ACCESS;
  const a = v as Partial<StoredWriteAccess>;
  if (a.state !== "yes" && a.state !== "no" && a.state !== "unknown") return NO_WRITE_ACCESS;
  return { state: a.state, message: typeof a.message === "string" ? a.message : null, checkedAt: typeof a.checkedAt === "string" ? a.checkedAt : null };
}

export async function saveWriteAccess(a: StoredWriteAccess): Promise<void> {
  await setIfChanged(KEYS.writeAccess, a);
}

/**
 * The Status option closing an issue also sets (SPEC §4.8, W2), chosen in
 * Settings. A project need not have an option called "Done", so this is an
 * option ID from the mapped Status field, not a name. Null = not chosen yet,
 * and closing is refused with the reason.
 */
export async function readCloseDoneStatus(): Promise<string | null> {
  const v = await get(KEYS.closeDoneStatus);
  return typeof v === "string" && v ? v : null;
}

export async function saveCloseDoneStatus(optionId: string | null): Promise<void> {
  await setIfChanged(KEYS.closeDoneStatus, optionId ?? "");
}

/** AI assist settings (SPEC §4.9). Never the API key. */
export async function readAiSettings(): Promise<AiSettings> {
  return parseAiSettings(await get(KEYS.ai));
}

export async function saveAiSettings(s: AiSettings): Promise<void> {
  await set(KEYS.ai, s);
}

/** What "Test connection" last passed for (`verifyId`), or null. Nothing is sent to a model before it matches the settings. */
export async function readAiVerified(): Promise<string | null> {
  const v = await get(KEYS.aiVerified);
  return typeof v === "string" && v ? v : null;
}

export async function saveAiVerified(id: string | null): Promise<void> {
  // The column is NOT NULL: "" means no pass.
  await set(KEYS.aiVerified, id ?? "");
}

/** Endpoints (base URLs) that refused `json_schema` and are asked for `json_object` instead. */
export async function readEndpointModes(): Promise<Record<string, "json_object">> {
  const v = await get(KEYS.aiEndpointModes);
  if (!v || typeof v !== "object") return {};
  return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, m]) => m === "json_object")) as Record<string, "json_object">;
}

export async function saveEndpointModes(modes: Record<string, "json_object">): Promise<void> {
  await set(KEYS.aiEndpointModes, modes);
}

/** The env target (tests and dev, D3), or null when it isn't set. */
function envTarget(): GithubTarget | null {
  try {
    return githubTarget();
  } catch (e) {
    if (e instanceof ConfigError) return null;
    throw e;
  }
}

export type ResolvedTarget = GithubTarget & { projectId: string | null; projectTitle: string; source: "settings" | "env" };

/** The target, or a ConfigError when neither settings nor env name one (sync and writes need it). */
export async function requireTarget(): Promise<ResolvedTarget> {
  const t = await currentTarget();
  if (!t) throw new ConfigError("No repository and project chosen yet");
  return t;
}

/**
 * The repository and project Deska reads: the stored settings, else the
 * `GITHUB_REPO` / `GITHUB_ORG` / `GITHUB_PROJECT_NUMBER` env vars (tests and
 * dev only; the desktop app sets none), else null.
 */
export async function currentTarget(): Promise<ResolvedTarget | null> {
  const stored = await readTarget();
  if (stored) {
    const [owner, repo] = stored.repo.split("/") as [string, string];
    return { repoFull: stored.repo, owner, repo, org: stored.org, projectNumber: stored.projectNumber, projectId: stored.projectId, projectTitle: stored.projectTitle, source: "settings" };
  }
  const env = envTarget();
  return env ? { ...env, projectId: process.env.GITHUB_PROJECT_ID?.trim() || null, projectTitle: "", source: "env" } : null;
}

/**
 * The repository `#123` links and GitHub reads default to: the stored target,
 * else `GITHUB_REPO`, else the demo label. The desktop app sets no env vars, so
 * reading `GITHUB_REPO` directly there threw or pointed at the demo repo.
 */
export async function linkRepo(): Promise<string> {
  return (await currentTarget().catch(() => null))?.repoFull ?? displayRepo();
}
