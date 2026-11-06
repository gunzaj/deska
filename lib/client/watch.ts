// The Watching page (IMPROVEMENTS F6): turning F0's history into sentences.
import { parseSetValue, type FieldChange } from "../sync/changes";
import { dimFieldId, isDimKey } from "../sync/field-map";
import type { ClientMeta } from "./types";

const FIELD_LABEL: Record<string, string> = {
  status: "Status",
  priority: "Priority",
  release: "Release",
  state: "State",
  labels: "Labels",
  assignees: "Assignees",
};

export type ChangeLine = { field: string; label: string; text: string };

const EMPTY = "none";

/** A value as people read it: option and iteration names, never IDs. */
type WatchMeta = Pick<ClientMeta, "fields" | "dimensions" | "releases" | "labels" | "issueTypes" | "milestones">;

function valueName(meta: WatchMeta, field: string, v: string | null): string {
  if (v == null || v === "") return EMPTY;
  if (isDimKey(field)) return meta.dimensions.find((d) => d.id === dimFieldId(field))?.options.find((o) => o.id === v)?.name ?? "a removed option";
  switch (field) {
    case "status":
    case "priority":
      return meta.fields[field as "status" | "priority"].find((o) => o.id === v)?.name ?? "a removed option";
    case "release":
      return meta.releases.find((r) => r.id === v)?.title ?? "a removed release";
    case "type":
      return meta.issueTypes.find((t) => t.id === v)?.name ?? "a removed type";
    case "milestone":
      return meta.milestones.find((m) => m.id === v)?.title ?? "a removed milestone";
    default:
      return v;
  }
}

/** "Status: To do → In progress", "Labels: added ui, removed bug", "Assignees: added bob". */
export function describeFieldChange(meta: WatchMeta, c: Pick<FieldChange, "field" | "oldValue" | "newValue">): ChangeLine {
  const label = isDimKey(c.field) ? (meta.dimensions.find((d) => d.id === dimFieldId(c.field))?.name ?? c.field) : (FIELD_LABEL[c.field] ?? c.field);
  if (c.field === "labels" || c.field === "assignees") {
    const was = new Set(parseSetValue(c.oldValue));
    const now = new Set(parseSetValue(c.newValue));
    const name = (id: string) => (c.field === "labels" ? (meta.labels.find((l) => l.id === id)?.name ?? "a removed label") : id);
    const parts = [
      ...[...now].filter((x) => !was.has(x)).map((x) => `added ${name(x)}`),
      ...[...was].filter((x) => !now.has(x)).map((x) => `removed ${name(x)}`),
    ];
    return { field: c.field, label, text: parts.join(", ") || "changed" };
  }
  return { field: c.field, label, text: `${valueName(meta, c.field, c.oldValue)} → ${valueName(meta, c.field, c.newValue)}` };
}

/**
 * Whether a change is worth a line: single-select values are also recorded by
 * field ID (`dim:<fieldId>`), so only those of mapped dimensions show; Status
 * and Priority have their own lines.
 */
export function isShownChange(meta: Pick<ClientMeta, "dimensions">, c: Pick<FieldChange, "field">): boolean {
  return !isDimKey(c.field) || meta.dimensions.some((d) => d.id === dimFieldId(c.field));
}
