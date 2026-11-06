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
import { ConfigError, githubTarget, type GithubTarget } from "./config";
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

const KEYS = { target: "github.target", mapping: "project.mapping" } as const;

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

/** The env target (tests and dev, D3), or null when it isn't set. */
function envTarget(): GithubTarget | null {
  try {
    return githubTarget();
  } catch (e) {
    if (e instanceof ConfigError) return null;
    throw e;
  }
}

export type ResolvedTarget = GithubTarget & { projectId: string | null; source: "settings" | "env" };

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
    return { repoFull: stored.repo, owner, repo, org: stored.org, projectNumber: stored.projectNumber, projectId: stored.projectId, source: "settings" };
  }
  const env = envTarget();
  return env ? { ...env, projectId: process.env.GITHUB_PROJECT_ID?.trim() || null, source: "env" } : null;
}
