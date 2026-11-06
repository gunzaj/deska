import { describe, expect, it } from "vitest";
import { ISSUE_LIST_HELP, ISSUE_LIST_KEYS, TASK_LIST_HELP, TASK_LIST_KEYS } from "@/lib/client/shortcuts";
import { MAX_SORT_KEYS, toggleSortKey } from "@/lib/client/sort";
import { decodeViewState, encodeViewState } from "@/lib/views/url";

describe("shortcut help", () => {
  it("lists every key action the issue lists handle, and no other", () => {
    expect(new Set(ISSUE_LIST_HELP.map((h) => h.action))).toEqual(new Set(Object.values(ISSUE_LIST_KEYS)));
  });
  it("lists every key action the task lists handle (plus the Alt+arrow moves)", () => {
    const handled = new Set<string>([...Object.values(TASK_LIST_KEYS), "move-up", "move-down"]);
    expect(new Set(TASK_LIST_HELP.map((h) => h.action))).toEqual(handled);
  });
  it("shows each handled letter key in the help", () => {
    const shown = new Set(ISSUE_LIST_HELP.flatMap((h) => h.keys.map((k) => k.toLowerCase())));
    for (const [key, action] of Object.entries(ISSUE_LIST_KEYS)) {
      if (key.length === 1) expect(shown.has(key), `${key} (${action})`).toBe(true);
    }
  });
});

describe("multi-key sort", () => {
  it("plain click resets to one key and flips it on the second click", () => {
    expect(toggleSortKey([{ field: "status", dir: "asc" }, { field: "title", dir: "asc" }], "priority", "desc", false)).toEqual([{ field: "priority", dir: "desc" }]);
    expect(toggleSortKey([{ field: "priority", dir: "desc" }], "priority", "desc", false)).toEqual([{ field: "priority", dir: "asc" }]);
  });
  it("shift-click adds keys up to four, and flips one already there", () => {
    let sort = toggleSortKey([], "priority", "desc", true);
    sort = toggleSortKey(sort, "status", "asc", true);
    sort = toggleSortKey(sort, "team", "asc", true);
    sort = toggleSortKey(sort, "title", "asc", true);
    expect(sort.map((s) => s.field)).toEqual(["priority", "status", "team", "title"]);
    expect(toggleSortKey(sort, "release", "asc", true)).toHaveLength(MAX_SORT_KEYS);
    expect(toggleSortKey(sort, "release", "asc", true).map((s) => s.field)).not.toContain("release");
    expect(toggleSortKey(sort, "team", "asc", true)[2]).toEqual({ field: "team", dir: "desc" });
  });
  it("round-trips three keys through the URL", () => {
    const sort = [
      { field: "priority", dir: "desc" as const },
      { field: "status", dir: "asc" as const },
      { field: "title", dir: "asc" as const },
    ];
    const qs = encodeViewState({ filters: [], sort, groupBy: undefined });
    expect(decodeViewState(qs).sort).toEqual(sort);
  });
});
