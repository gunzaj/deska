// SPEC §4.2: a built-in list keeps its own filters and display options. The
// stored map is untrusted input like an imported view (backups, exports).
import { describe, expect, it } from "vitest";
import { LIST_PREFS_LIMIT, listKeySchema, listStateSchema, parseListPrefs } from "@/lib/views/list-prefs";

const state = {
  filters: [{ field: "state", op: "in", values: ["open"] }],
  sort: [{ field: "updated", dir: "desc" }],
  layout: "list",
  columns: ["id", "status"],
};

describe("built-in list defaults", () => {
  it("accepts a filter and display state, board fields included", () => {
    expect(listStateSchema.safeParse(state).success).toBe(true);
    expect(
      listStateSchema.safeParse({ ...state, layout: "board", groupBy: "status", boardColumnsField: "priority" }).success,
    ).toBe(true);
  });

  it("rejects unknown keys, an unknown layout and an invalid filter", () => {
    expect(listStateSchema.safeParse({ ...state, junk: true }).success).toBe(false);
    expect(listStateSchema.safeParse({ ...state, layout: "calendar" }).success).toBe(false);
    expect(listStateSchema.safeParse({ ...state, filters: [{ field: "nope", op: "in", values: ["x"] }] }).success).toBe(false);
  });

  it("keys are page names, not display names", () => {
    for (const key of ["my", "issues", "backlog", "epics", "release", "dimension:a0000001"]) expect(listKeySchema.safeParse(key).success).toBe(true);
    for (const key of ["My issues", "my:", ":my", "My", "x".repeat(200)]) expect(listKeySchema.safeParse(key).success).toBe(false);
  });

  it("reads valid pages and skips a bad key or state", () => {
    const raw = {
      my: state,
      epics: { ...state, layout: "board" },
      "Not a key": state,
      issues: { layout: "list", filters: [{ field: "nope", op: "in" }], sort: [] },
      backlog: "nope",
    };
    expect(parseListPrefs(raw)).toEqual({ my: state, epics: { ...state, layout: "board" } });
  });

  it("reads anything that is not a map as no defaults", () => {
    for (const raw of [null, undefined, "my", 7, [state]]) expect(parseListPrefs(raw)).toEqual({});
  });

  it("caps the map", () => {
    const raw = Object.fromEntries(Array.from({ length: LIST_PREFS_LIMIT + 5 }, (_, n) => [`page-${n}`, state]));
    expect(Object.keys(parseListPrefs(raw))).toHaveLength(LIST_PREFS_LIMIT);
  });
});
