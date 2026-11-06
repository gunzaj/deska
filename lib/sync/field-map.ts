// The logical project field (Status, Priority, Team, Platform, Release) -> the
// project field GitHub reports, resolved once and then carried by field ID
// through sync, writes and the read model (v5 1.3). Names are only how a
// field is first found; after that the ID keeps the mapping through a rename
// ("Release" -> "Sprint"), so nothing is blanked and no phantom F0 changes
// are recorded. AGENTS: never hardcode what the project calls things.

type Env = Record<string, string | undefined>;

export const LOGICAL_FIELDS = ["status", "priority", "team", "platform", "release"] as const;
export type LogicalField = (typeof LOGICAL_FIELDS)[number];

export type FieldRef = { id: string; name: string };
/** Null: the project has no field for that key (its values are left alone). */
export type ProjectFieldMap = Record<LogicalField, FieldRef | null>;

/** The key sync_state stores the map under (JSON). */
export const FIELD_MAP_KEY = "fields.map";

export const EMPTY_FIELD_MAP: ProjectFieldMap = { status: null, priority: null, team: null, platform: null, release: null };

/** Default name per key, each overridable by `PROJECT_<KEY>_FIELD`. */
export function configuredNames(env: Env = process.env): Record<LogicalField, { name: string; overridden: boolean }> {
  const out = {} as Record<LogicalField, { name: string; overridden: boolean }>;
  for (const key of LOGICAL_FIELDS) {
    const override = env[`PROJECT_${key.toUpperCase()}_FIELD`]?.trim();
    out[key] = { name: override || key[0]!.toUpperCase() + key.slice(1), overridden: !!override };
  }
  return out;
}

type DiscoveredField = { id: string; name: string; dataType?: string };

/**
 * Resolve the map from the discovered fields.
 *
 * Per key: an env override that matches a field wins; otherwise a field the
 * `previous` map already pinned (by ID, so a rename is followed); otherwise
 * the default name, case-insensitively. Release also falls back to the
 * project's sole iteration field. Nothing found gives null, never a guess.
 */
export function resolveFieldMap(
  fields: readonly DiscoveredField[],
  previous: ProjectFieldMap | null = null,
  env: Env = process.env,
): ProjectFieldMap {
  const byId = new Map(fields.map((f) => [f.id, f]));
  const byName = new Map(fields.map((f) => [f.name.toLowerCase(), f]));
  const names = configuredNames(env);
  const out = { ...EMPTY_FIELD_MAP };
  for (const key of LOGICAL_FIELDS) {
    const { name, overridden } = names[key];
    const named = byName.get(name.toLowerCase());
    const pinned = previous?.[key] ? byId.get(previous[key]!.id) : undefined;
    let found = overridden ? (named ?? pinned) : (pinned ?? named);
    if (!found && key === "release") {
      const iterations = fields.filter((f) => f.dataType === "ITERATION");
      if (iterations.length === 1) found = iterations[0];
    }
    out[key] = found ? { id: found.id, name: found.name } : null;
  }
  return out;
}

export function serializeFieldMap(map: ProjectFieldMap): string {
  return JSON.stringify(map);
}

/** A stored map, or null when absent or unreadable (the caller resolves a fresh one). */
export function parseFieldMap(raw: string | null | undefined): ProjectFieldMap | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<Record<LogicalField, unknown>>;
    const out = { ...EMPTY_FIELD_MAP };
    for (const key of LOGICAL_FIELDS) {
      const ref = v[key] as Partial<FieldRef> | null | undefined;
      out[key] = ref && typeof ref.id === "string" && typeof ref.name === "string" ? { id: ref.id, name: ref.name } : null;
    }
    return out;
  } catch {
    return null;
  }
}

export function sameFieldMap(a: ProjectFieldMap, b: ProjectFieldMap): boolean {
  return LOGICAL_FIELDS.every((k) => a[k]?.id === b[k]?.id && a[k]?.name === b[k]?.name);
}

/**
 * Recompute the map from the discovered fields and store it when it changed.
 * Returns the current map. Pinned IDs survive a rename; see `resolveFieldMap`.
 */
export function refreshFieldMap(
  kv: { get(key: string): string | null; set(key: string, value: string): void },
  fields: readonly DiscoveredField[],
): ProjectFieldMap {
  const previous = parseFieldMap(kv.get(FIELD_MAP_KEY));
  const next = resolveFieldMap(fields, previous);
  if (!previous || !sameFieldMap(previous, next)) kv.set(FIELD_MAP_KEY, serializeFieldMap(next));
  return next;
}
