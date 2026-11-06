import { describe, expect, it } from "vitest";
import { teamFilter, validDefaultTeam, withTeamScope } from "@/lib/client/team-scope";
import type { Filter } from "@/lib/views/view";

const meta = { fields: { team: [{ id: "t1", name: "Core", color: "" }, { id: "t2", name: "Firmware", color: "" }] } } as never;

describe("default team filter", () => {
  it("only a Team that still exists counts", () => {
    expect(validDefaultTeam("t1", meta)).toBe("t1");
    expect(validDefaultTeam("gone", meta)).toBeNull();
    expect(validDefaultTeam(null, meta)).toBeNull();
  });

  it("adds the Team to a page's filters, and nothing without a default", () => {
    const open: Filter = { field: "state", op: "in", values: ["open"] };
    expect(withTeamScope([open], [], "t1")).toEqual([open, teamFilter("t1")]);
    expect(withTeamScope([open], [], null)).toEqual([open]);
  });

  it("leaves a page alone when it already says something about Team", () => {
    const mine: Filter = { field: "team", op: "in", values: ["t2"] };
    expect(withTeamScope([mine], [], "t1")).toEqual([mine]);
    expect(withTeamScope([], [mine], "t1")).toEqual([]);
    const either: Filter = { field: "any", filters: [{ field: "priority", op: "empty" }, { field: "team", op: "empty" }] };
    expect(withTeamScope([], [either], "t1")).toEqual([]);
  });
});
