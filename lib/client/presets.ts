// Default explorer states for the built-in pages.
import type { Filter } from "../views/view";
import type { ExplorerState } from "./explorer";

export const OPEN: Filter = { field: "state", op: "in", values: ["open"] };

export const PRESETS = {
  my: {
    filters: [OPEN],
    sort: [
      { field: "priority", dir: "desc" },
      { field: "updated", dir: "desc" },
    ],
    groupBy: "status",
    layout: "list",
  },
  all: {
    filters: [OPEN],
    sort: [{ field: "updated", dir: "desc" }],
    layout: "list",
  },
  backlog: {
    filters: [OPEN],
    sort: [
      { field: "priority", dir: "desc" },
      { field: "updated", dir: "desc" },
    ],
    groupBy: "priority",
    layout: "list",
  },
  team: {
    filters: [OPEN],
    sort: [
      { field: "priority", dir: "desc" },
      { field: "updated", dir: "desc" },
    ],
    groupBy: "status",
    layout: "list",
  },
  release: {
    filters: [],
    sort: [
      { field: "priority", dir: "desc" },
      { field: "updated", dir: "desc" },
    ],
    layout: "board",
    boardColumnsField: "status",
  },
  blank: {
    filters: [OPEN],
    sort: [{ field: "updated", dir: "desc" }],
    layout: "list",
  },
} satisfies Record<string, ExplorerState> as Record<"my" | "all" | "backlog" | "team" | "release" | "blank", ExplorerState>;
