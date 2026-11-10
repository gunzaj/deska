// Onboarding step 2 and Settings → Project and fields (SPEC D4, §2.4, §4.1):
// which repository and org project Deska reads, and which project field plays
// which role. Discovery reads GitHub with the read-only client; the choice is
// stored locally (lib/settings.ts) with the project's node ID pinned, and the
// project's fields go into the cache so the read model knows them right away.
import { dbDir, getDb } from "@/db";
import { clearGithubCache, LocalDataError } from "../backup/local-data";
import { githubApiBase } from "../config";
import { createReadOnlyClient, type ReadOnlyClient } from "../github/probe";
import { checkRepo, fetchProjectDetail, listOrgProjects, ProjectReadError, type OrgProject, type ProjectDetail } from "../github/projects";
import { localToken } from "../github/local-token";
import { currentTarget, readMapping, readTarget, saveMapping, saveTarget, saveTasksOnly, type StoredTarget } from "../settings";
import { bumpGeneration } from "../sync/generation";
import { importFull } from "../sync/import";
import { followRenames, missingFields, ROLES, sameFieldMap, suggestMapping, validateMapping, type FieldMapping, type MissingField } from "../sync/field-map";
import type { ReadModel } from "../sync/read-model";
import { initialImportDone, withLockedSyncKv } from "../sync/runtime";
import { syncService } from "../sync/service";
import { PostgresStore } from "../sync/store-postgres";
import { partialSnapshot, type SnapshotField } from "../sync/types";
import { sql } from "drizzle-orm";
import { getStore, invalidateReadCache } from "../store";
import { HttpError } from "./route";

/** A field as the mapping screen shows it. */
export type SetupField = {
  id: string;
  name: string;
  dataType: string;
  options: { id: string; name: string; color: string }[];
  iterations: number;
};

export type SetupState = {
  /** The stored target, or the env one (tests, dev), or null. */
  target: (Omit<StoredTarget, "projectId" | "projectTitle"> & { projectId: string | null; projectTitle: string; source: "settings" | "env" }) | null;
  /** The stored mapping, or null before step 2 is done. */
  mapping: FieldMapping | null;
  /** What onboarding offers: the stored mapping, else a suggestion from the fields. */
  suggestion: FieldMapping;
  fields: SetupField[];
  missing: MissingField[];
  /** A token is there to discover projects with (the desktop app). */
  canDiscover: boolean;
};

function readOnlyClient(): ReadOnlyClient {
  const token = localToken();
  if (!token) throw new HttpError(409, "Connect a GitHub token first");
  return createReadOnlyClient(token, fetch, { apiBase: githubApiBase(), userAgent: "deska", timeoutMs: 15_000 });
}

function asHttp(e: unknown): never {
  if (e instanceof ProjectReadError) throw new HttpError(e.status === 401 ? 401 : 502, e.message, { githubStatus: e.status });
  throw e;
}

const setupField = (f: { id: string; name: string; dataType: string; options?: { id: string; name: string; color: string }[]; iterations?: unknown[] }): SetupField => ({
  id: f.id,
  name: f.name,
  dataType: f.dataType,
  options: (f.options ?? []).map((o) => ({ id: o.id, name: o.name, color: o.color })),
  iterations: f.iterations?.length ?? 0,
});

function cachedFields(store: ReadModel): SetupField[] {
  return [...store.fields.entries()].map(([id, f]) => setupField({ id, ...f }));
}

/** Everything the mapping screens need, from the cache (no GitHub call). */
export async function setupState(): Promise<SetupState> {
  const [stored, target, mapping, store] = await Promise.all([readTarget(), currentTarget(), readMapping(), getStore()]);
  const fields = cachedFields(store);
  const discovered = store.listFields();
  return {
    target: target
      ? { repo: target.repoFull, org: target.org, projectNumber: target.projectNumber, projectId: target.projectId, projectTitle: stored?.projectTitle ?? "", source: target.source }
      : null,
    mapping: mapping ? followRenames(mapping, discovered) : null,
    suggestion: mapping ? followRenames(mapping, discovered) : suggestMapping(discovered),
    fields,
    missing: mapping ? missingFields(mapping, discovered) : [],
    canDiscover: !!localToken(),
  };
}

/** The org's projects the token can read. */
export async function discoverProjects(org: string): Promise<OrgProject[]> {
  return listOrgProjects(readOnlyClient(), org).catch(asHttp);
}

/** One project's fields, live from GitHub, with the suggested mapping for them. */
export async function previewProject(repo: string, org: string, number: number): Promise<{ project: ProjectDetail; fields: SetupField[]; suggestion: FieldMapping }> {
  const client = readOnlyClient();
  await checkRepo(client, repo).catch(asHttp);
  const project = await fetchProjectDetail(client, org, number).catch(asHttp);
  const stored = await readMapping();
  // Same project again (Settings): start from what is mapped; else suggest.
  const same = (await readTarget())?.projectId === project.id;
  return { project, fields: project.fields.map(setupField), suggestion: same && stored ? followRenames(stored, project.fields) : suggestMapping(project.fields) };
}

/** Put a project's whole field list into the cache: renames land, deleted fields are marked missing. */
async function importFields(projectId: string, fields: SnapshotField[]): Promise<void> {
  const snapshot = partialSnapshot({ projectId, fields });
  if (dbDir()) {
    const res = await withLockedSyncKv(() => importFull(snapshot, new PostgresStore()), { waitMs: 30_000, retryMs: 250 });
    // The lock never came free: the fields are not cached, so this must not report success.
    if (!res.ran) throw new HttpError(409, "A sync is running, try again");
  } else {
    const { getDemoStore } = await import("../demo/store");
    await importFull(snapshot, await getDemoStore());
  }
  invalidateReadCache();
}

/**
 * After a remap, the Status, Priority and Sprint columns are taken from the
 * values stored by field ID: no new scan, and no field change is recorded
 * (nothing changed on GitHub).
 */
async function reproject(prev: FieldMapping | null, next: FieldMapping): Promise<void> {
  const changed = ROLES.filter((r) => prev?.[r]?.id !== next[r]?.id);
  if (!changed.length) return;
  const column = { status: "status_opt", priority: "priority_opt", sprint: "release_iter" } as const;
  const prop = { status: "statusOpt", priority: "priorityOpt", sprint: "releaseIter" } as const;
  if (dbDir()) {
    await getDb().transaction(async (tx) => {
      for (const role of changed) {
        const col = sql.raw(column[role]);
        const value = sql`(SELECT d.option_id FROM project_item_dims d WHERE d.item_id = project_items.id AND d.field_id = ${next[role]?.id ?? ""})`;
        await tx.execute(sql`UPDATE project_items SET ${col} = ${value} WHERE ${col} IS DISTINCT FROM ${value}`);
      }
      await bumpGeneration(tx);
    });
  } else {
    const store = await getStore();
    for (const item of store.projectItems.values()) {
      for (const role of changed) item[prop[role]] = (next[role] ? item.dims?.[next[role]!.id] : undefined) ?? null;
    }
  }
  invalidateReadCache();
}

/** Validate a mapping against the fields and store it. */
async function storeMapping(mapping: FieldMapping, fields: { id: string; name: string; dataType?: string; options?: { id: string; name: string }[] }[]): Promise<FieldMapping> {
  const errors = validateMapping(mapping, fields);
  if (errors.length) throw new HttpError(400, errors[0]!, { errors });
  const clean = followRenames(mapping, fields);
  const prev = await readMapping();
  await saveMapping(clean);
  if (!prev || !sameFieldMap(prev, clean)) await reproject(prev, clean);
  invalidateReadCache();
  return clean;
}

/**
 * Onboarding step 2 (and "Change project" in Settings): read the project from
 * GitHub again, pin its node ID, cache its fields, store the target and the
 * mapping. Needs the token; nothing is written to GitHub.
 */
export async function chooseProject(input: { repo: string; org: string; projectNumber: number; mapping: FieldMapping }): Promise<SetupState> {
  const client = readOnlyClient();
  await checkRepo(client, input.repo).catch(asHttp);
  const project = await fetchProjectDetail(client, input.org, input.projectNumber).catch(asHttp);
  const errors = validateMapping(input.mapping, project.fields);
  if (errors.length) throw new HttpError(400, errors[0]!, { errors });
  // Another repository or project: the cached issues, items and sync cursors
  // belong to the old one. Keeping them made the next poll skip the first
  // import and fetch only what changed after the old repo's cursor.
  const prev = await readTarget();
  if (prev && dbDir() && (prev.repo.toLowerCase() !== input.repo.toLowerCase() || prev.projectId !== project.id)) {
    await clearGithubCache().catch((e) => {
      throw e instanceof LocalDataError ? new HttpError(e.status, e.message) : e;
    });
  }
  await importFields(project.id, project.fields);
  await saveTarget({ repo: input.repo, org: input.org, projectNumber: project.number, projectId: project.id, projectTitle: project.title });
  await storeMapping(input.mapping, project.fields);
  // Choosing a project ends "tasks only".
  await saveTasksOnly(false);
  // First connect: the import starts now; the app shows its progress (D5).
  if (localToken()) void syncService().request("project");
  return setupState();
}

/** Settings → remap: a new mapping for the fields already known (the cache's). */
export async function remap(mapping: FieldMapping): Promise<SetupState> {
  const store = await getStore();
  await storeMapping(mapping, store.listFields());
  return setupState();
}

/**
 * Settings → "Reload fields": read the stored project's fields from GitHub
 * again. A renamed field keeps its mapping; a deleted one is reported as
 * "Missing field — remap".
 */
export async function reloadFields(): Promise<SetupState> {
  const target = await readTarget();
  if (!target) throw new HttpError(409, "Choose a project first");
  const project = await fetchProjectDetail(readOnlyClient(), target.org, target.projectNumber).catch(asHttp);
  // The project number now names a different project: refuse, like writes do (§3.2).
  if (project.id !== target.projectId) throw new HttpError(409, `Project ${target.projectNumber} in "${target.org}" is no longer the project Deska pinned. Choose the project again.`);
  await importFields(project.id, project.fields);
  return setupState();
}

/** Whether the desktop app shows the first import's progress instead of the (still empty or partial) cache. */
export async function needsFirstImport(): Promise<boolean> {
  return dbDir() !== null && !(await initialImportDone());
}

/** Whether the app still needs step 2: in the desktop app, until a project and a mapping are stored. */
export async function needsProjectSetup(): Promise<boolean> {
  const [target, mapping] = await Promise.all([readTarget(), readMapping()]);
  return !target || !mapping;
}
