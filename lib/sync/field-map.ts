// Project field mapping (SPEC §4.1): which project field plays which role.
//
// Roles: Status (single-select, required), Priority (single-select), Sprint
// (iteration) and any number of Dimensions (the other single-selects, e.g. a
// team or platform field). The user confirms the mapping in onboarding and
// can remap in Settings; it is stored by field ID, so a renamed field stays
// mapped and a deleted one is reported as missing instead of showing blank
// values. Names only matter for the first suggestion. AGENTS: never hardcode
// what the project calls its fields or options.

type Env = Record<string, string | undefined>;

export type FieldRef = { id: string; name: string };

/** The roles a field can be mapped to, plus the dimensions. */
export type ProjectFieldMap = {
  status: FieldRef | null;
  priority: FieldRef | null;
  sprint: FieldRef | null;
  dimensions: FieldRef[];
};

export const ROLES = ["status", "priority", "sprint"] as const;
export type Role = (typeof ROLES)[number];

/** Which end of the Priority field's option list is the most important. */
export type PriorityOrder = "highest-first" | "lowest-first";

/** What the user confirmed: the map plus the settings that come with it. */
export type FieldMapping = ProjectFieldMap & {
  priorityOrder: PriorityOrder;
  /** Status options that also count as done (§4.5); empty by default. */
  doneStatusIds: string[];
};

export const EMPTY_FIELD_MAP: ProjectFieldMap = { status: null, priority: null, sprint: null, dimensions: [] };

/** A field as discovered on GitHub (or in the cache). */
export type DiscoveredField = { id: string; name: string; dataType?: string; options?: { id: string; name: string }[] };

/** The GitHub field type a role needs. */
export const ROLE_TYPE: Record<Role, "SINGLE_SELECT" | "ITERATION"> = { status: "SINGLE_SELECT", priority: "SINGLE_SELECT", sprint: "ITERATION" };

export const ROLE_LABEL: Record<Role, string> = { status: "Status", priority: "Priority", sprint: "Sprint" };

/**
 * Names that suggest a role, best first. Only a suggestion the user confirms
 * in onboarding: the stored mapping is by field ID.
 */
const SUGGEST: Record<Role, string[]> = {
  status: ["status", "state", "stage", "progress"],
  priority: ["priority", "urgency", "severity", "importance"],
  sprint: ["sprint", "iteration", "cycle", "release"],
};

/** `PROJECT_<ROLE>_FIELD` (tests, dev): a field name that wins over the suggestion. */
export function envOverrides(env: Env = process.env): Partial<Record<Role, string>> {
  const out: Partial<Record<Role, string>> = {};
  for (const role of ROLES) {
    const v = env[`PROJECT_${role.toUpperCase()}_FIELD`]?.trim();
    if (v) out[role] = v;
  }
  return out;
}

const isType = (f: DiscoveredField, type: string) => (f.dataType ?? "").toUpperCase() === type;
const ref = (f: DiscoveredField): FieldRef => ({ id: f.id, name: f.name });

/**
 * A suggested mapping from the discovered fields: per role, an env override
 * by name, else the first field of the right type whose name matches the
 * role's words (whole name first, then as a word in it); Sprint falls back to
 * the project's only iteration field. Every other single-select becomes a
 * dimension. Nothing found gives null, never a guess of the wrong type.
 */
export function suggestFieldMap(fields: readonly DiscoveredField[], env: Env = process.env): ProjectFieldMap {
  const overrides = envOverrides(env);
  const out: ProjectFieldMap = { ...EMPTY_FIELD_MAP, dimensions: [] };
  const taken = new Set<string>();
  for (const role of ROLES) {
    const typed = fields.filter((f) => isType(f, ROLE_TYPE[role]) && !taken.has(f.id));
    let found: DiscoveredField | undefined;
    const override = overrides[role]?.toLowerCase();
    if (override) found = fields.find((f) => f.name.toLowerCase() === override && !taken.has(f.id));
    if (!found) {
      for (const word of SUGGEST[role]) {
        found = typed.find((f) => f.name.trim().toLowerCase() === word);
        if (found) break;
      }
    }
    if (!found) {
      for (const word of SUGGEST[role]) {
        found = typed.find((f) => new RegExp(`\\b${word}`, "i").test(f.name));
        if (found) break;
      }
    }
    if (!found && role === "sprint" && typed.length === 1) found = typed[0];
    if (found) {
      out[role] = ref(found);
      taken.add(found.id);
    }
  }
  out.dimensions = fields.filter((f) => isType(f, "SINGLE_SELECT") && !taken.has(f.id)).map(ref);
  return out;
}

const HIGH = /^(p0|0\b|urgent|critical|blocker|highest|high)/i;
const LOW = /^(p[3-9]|low|lowest|minor|trivial|nice)/i;

/** Which way round a Priority field's options look to be, from their names; highest-first when unclear. */
export function suggestPriorityOrder(options: readonly { name: string }[]): PriorityOrder {
  const plain = (s: string) => s.replace(/[^\p{L}\p{N} ]/gu, "").trim();
  const first = plain(options[0]?.name ?? "");
  const last = plain(options[options.length - 1]?.name ?? "");
  if (LOW.test(first) || HIGH.test(last)) return HIGH.test(first) ? "highest-first" : "lowest-first";
  return "highest-first";
}

/** A full suggested mapping (onboarding's starting point). */
export function suggestMapping(fields: readonly DiscoveredField[], env: Env = process.env): FieldMapping {
  const map = suggestFieldMap(fields, env);
  const priority = map.priority ? fields.find((f) => f.id === map.priority!.id) : undefined;
  return { ...map, priorityOrder: suggestPriorityOrder(priority?.options ?? []), doneStatusIds: [] };
}

/**
 * The map with every name taken from the discovered fields (a renamed field
 * keeps its role and shows its new name). A mapped field GitHub no longer
 * lists keeps its last known name; `missingFields` reports it.
 */
export function followRenames<T extends ProjectFieldMap>(map: T, fields: readonly DiscoveredField[]): T {
  const byId = new Map(fields.map((f) => [f.id, f]));
  const fresh = (r: FieldRef | null) => (r ? { id: r.id, name: byId.get(r.id)?.name ?? r.name } : null);
  return { ...map, status: fresh(map.status), priority: fresh(map.priority), sprint: fresh(map.sprint), dimensions: map.dimensions.map((d) => fresh(d)!) };
}

export type MissingField = { role: Role | "dimension"; id: string; name: string };

/**
 * Mapped fields the project no longer has (deleted on GitHub): shown as
 * "Missing field — remap", never as blank values. With no fields known at all
 * (nothing synced yet) nothing counts as missing.
 */
export function missingFields(map: ProjectFieldMap, fields: readonly DiscoveredField[]): MissingField[] {
  if (!fields.length) return [];
  const ids = new Set(fields.map((f) => f.id));
  const out: MissingField[] = [];
  for (const role of ROLES) {
    const r = map[role];
    if (r && !ids.has(r.id)) out.push({ role, id: r.id, name: r.name });
  }
  for (const d of map.dimensions) if (!ids.has(d.id)) out.push({ role: "dimension", id: d.id, name: d.name });
  return out;
}

/** The text shown in place of values of a deleted field. */
export const MISSING_FIELD = "Missing field — remap";

// --- validation and storage ------------------------------------------------------

const isRef = (v: unknown): v is FieldRef => !!v && typeof (v as FieldRef).id === "string" && typeof (v as FieldRef).name === "string";

/** A stored mapping, or null when absent or unreadable. */
export function parseMapping(raw: unknown): FieldMapping | null {
  if (!raw || typeof raw !== "object") return null;
  const v = raw as Record<string, unknown>;
  const one = (x: unknown) => (isRef(x) ? { id: x.id, name: x.name } : null);
  const dims = Array.isArray(v.dimensions) ? v.dimensions.filter(isRef).map((d) => ({ id: d.id, name: d.name })) : [];
  return {
    status: one(v.status),
    priority: one(v.priority),
    sprint: one(v.sprint),
    dimensions: dims,
    priorityOrder: v.priorityOrder === "lowest-first" ? "lowest-first" : "highest-first",
    doneStatusIds: Array.isArray(v.doneStatusIds) ? v.doneStatusIds.filter((x): x is string => typeof x === "string") : [],
  };
}

/**
 * Problems with a mapping against the discovered fields, as messages; empty
 * when it can be saved. Status is required; every mapped field must exist,
 * have the role's type and appear once; done options must be Status options.
 */
export function validateMapping(m: FieldMapping, fields: readonly DiscoveredField[]): string[] {
  const errors: string[] = [];
  const byId = new Map(fields.map((f) => [f.id, f]));
  if (!m.status) errors.push("Choose the Status field.");
  const seen = new Set<string>();
  const check = (r: FieldRef | null, type: string, label: string) => {
    if (!r) return;
    const f = byId.get(r.id);
    if (!f) errors.push(`${label}: the field is not in the project.`);
    else if (!isType(f, type)) errors.push(`${label}: "${f.name}" is not a ${type === "ITERATION" ? "iteration" : "single-select"} field.`);
    if (seen.has(r.id)) errors.push(`${label}: "${f?.name ?? r.name}" is already mapped.`);
    seen.add(r.id);
  };
  for (const role of ROLES) check(m[role], ROLE_TYPE[role], ROLE_LABEL[role]);
  for (const d of m.dimensions) check(d, "SINGLE_SELECT", "Dimension");
  const statusOptions = new Set((m.status ? byId.get(m.status.id)?.options : undefined)?.map((o) => o.id) ?? []);
  if (m.doneStatusIds.some((id) => !statusOptions.has(id))) errors.push("Done options must be options of the Status field.");
  return errors;
}

/**
 * The map the app runs on: the user's (stored) mapping with current names,
 * or, before one is stored (tests, the dev preview), the suggestion from the
 * fields themselves.
 */
export function effectiveMapping(stored: FieldMapping | null, fields: readonly DiscoveredField[], env: Env = process.env): FieldMapping {
  return stored ? followRenames(stored, fields) : suggestMapping(fields, env);
}

/** Option IDs ordered lowest to highest priority, whatever order the project keeps them in. */
export function priorityLowToHigh<T>(options: readonly T[], order: PriorityOrder): T[] {
  return order === "highest-first" ? [...options].reverse() : [...options];
}

/** The field IDs of a map, for comparing two maps. */
export function sameFieldMap(a: ProjectFieldMap, b: ProjectFieldMap): boolean {
  const key = (m: ProjectFieldMap) => JSON.stringify([m.status?.id, m.priority?.id, m.sprint?.id, m.dimensions.map((d) => d.id)]);
  return key(a) === key(b);
}

/** The `dim:<fieldId>` key filters, grouping, board columns and edits use for a dimension. */
export const DIM_PREFIX = "dim:";
export const dimKey = (fieldId: string): `dim:${string}` => `dim:${fieldId}`;
export const isDimKey = (key: string | undefined | null): key is `dim:${string}` => typeof key === "string" && key.startsWith(DIM_PREFIX) && key.length > DIM_PREFIX.length;
export const dimFieldId = (key: string) => key.slice(DIM_PREFIX.length);
