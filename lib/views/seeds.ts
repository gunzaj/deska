import type { ReadModel } from "../sync/read-model";
import type { View } from "./view";

/** Option IDs resolved from discovered names — never hardcoded (SPEC §2). */
function optionId(store: ReadModel, key: "team", namePart: string): string | null {
  const ref = store.projectFieldMap()[key];
  const f = ref ? store.fields.get(ref.id) : undefined;
  return f?.options.find((x) => x.name.includes(namePart))?.id ?? null;
}

/**
 * Seed views that need no discovered option IDs. Used as a fallback when the
 * cache has not been synced yet, so /views renders instead of throwing.
 */
export function seedViews(ownerId: string): View[] {
  const base = {
    ownerId,
    visibility: "shared" as const,
  };
  return [
    {
      ...base,
      id: "seed-untriaged",
      name: "Untriaged backlog",
      layout: "list",
      filters: [{ field: "state", op: "in", values: ["open"] }],
      sort: [{ field: "created", dir: "desc" }],
    },
    {
      ...base,
      id: "seed-epics",
      name: "Epics & sub-issues",
      layout: "list",
      filters: [{ field: "parent", op: "has_sub_issues" }],
      sort: [{ field: "updated", dir: "desc" }],
      groupBy: "parent",
    },
  ];
}

/**
 * The 5 SPEC §4 seed views. Any view whose discovered option is missing is
 * skipped rather than throwing, so one renamed Team cannot break the whole
 * views page.
 */
export function trySeedViews(store: ReadModel, ownerId: string): View[] {
  const core = optionId(store, "team", "Core");
  const views: View[] = [
    {
      id: "seed-my-tickets",
      name: "My tickets by priority",
      ownerId,
      visibility: "shared",
      layout: "list",
      filters: [
        { field: "assignee", op: "in", values: ["me"] },
        { field: "state", op: "in", values: ["open"] },
      ],
      sort: [
        { field: "priority", dir: "desc" },
        { field: "updated", dir: "desc" },
      ],
      groupBy: "priority",
    },
    {
      id: "seed-untriaged",
      name: "Untriaged backlog",
      ownerId,
      visibility: "shared",
      layout: "list",
      // SPEC §4: open AND (Priority empty OR Release empty).
      filters: [
        { field: "state", op: "in", values: ["open"] },
        {
          field: "any",
          filters: [
            { field: "priority", op: "empty" },
            { field: "release", op: "empty" },
          ],
        },
      ],
      sort: [{ field: "created", dir: "desc" }],
    },
    {
      id: "seed-release-teams",
      name: "Current Release by Team",
      ownerId,
      visibility: "shared",
      layout: "table",
      filters: [{ field: "release", op: "in", values: ["current"] }],
      sort: [{ field: "updated", dir: "desc" }],
      groupBy: "team",
    },
    {
      id: "seed-epics",
      name: "Epics & sub-issues",
      ownerId,
      visibility: "shared",
      layout: "list",
      filters: [{ field: "parent", op: "has_sub_issues" }],
      sort: [{ field: "updated", dir: "desc" }],
      groupBy: "parent",
    },
  ];
  if (core) {
    views.splice(1, 0, {
      id: "seed-core-board",
      name: "Core current Release board",
      ownerId,
      visibility: "shared",
      layout: "board",
      filters: [
        { field: "team", op: "in", values: [core] },
        { field: "release", op: "in", values: ["current"] },
      ],
      sort: [{ field: "updated", dir: "desc" }],
      boardColumnsField: "status",
    });
  }
  return views;
}
