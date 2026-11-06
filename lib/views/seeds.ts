import { dimKey } from "../sync/field-map";
import type { ReadModel } from "../sync/read-model";
import type { View } from "./view";

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
 * The seed views, built from the field mapping (§4.1): views that need the
 * Sprint field or a dimension are left out when the project has none. No
 * field or option is looked up by name (SPEC §0.2).
 */
export function trySeedViews(store: ReadModel, ownerId: string): View[] {
  const map = store.projectFieldMap();
  const sprint = !!map.sprint && store.fields.has(map.sprint.id);
  const dim = map.dimensions.find((d) => store.fields.has(d.id));
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
      // Open AND (Priority empty OR Sprint empty); just Priority without a Sprint field.
      filters: [
        { field: "state", op: "in", values: ["open"] },
        sprint
          ? {
              field: "any",
              filters: [
                { field: "priority", op: "empty" },
                { field: "release", op: "empty" },
              ],
            }
          : { field: "priority", op: "empty" },
      ],
      sort: [{ field: "created", dir: "desc" }],
    },
    ...(sprint
      ? [
          {
            id: "seed-release-teams",
            name: dim ? `Current Release by ${dim.name}` : "Current Release",
            ownerId,
            visibility: "shared",
            layout: "table",
            filters: [{ field: "release", op: "in", values: ["current"] }],
            sort: [{ field: "updated", dir: "desc" }],
            ...(dim ? { groupBy: dimKey(dim.id) } : {}),
          } satisfies View,
        ]
      : []),
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
  return views;
}
