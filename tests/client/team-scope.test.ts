// "My default" (§4.1, §4.2): one value of a mapped dimension that lists and
// Insights start filtered to, unless the page already filters that dimension.
import { describe, expect, it } from "vitest";
import { scopeFilter, validDefault, withDefaultScope } from "@/lib/client/team-scope";
import type { ClientDimension } from "@/lib/client/types";
import type { Filter } from "@/lib/views/view";

const squad: ClientDimension = { id: "F_squad", key: "dim:F_squad", name: "Squad", missing: false, options: [{ id: "t1", name: "Core", color: "", position: 0 }, { id: "t2", name: "Firmware", color: "", position: 1 }] };
const gone: ClientDimension = { id: "F_gone", key: "dim:F_gone", name: "Old", missing: true, options: [{ id: "o1", name: "Old value", color: "", position: 0 }] };
const meta = { dimensions: [squad, gone] };

describe("default dimension value", () => {
  it("only an option of a mapped, existing dimension counts", () => {
    expect(validDefault("t1", meta)).toEqual({ dimension: squad, optionId: "t1", name: "Core" });
    expect(validDefault("gone", meta)).toBeNull();
    expect(validDefault("o1", meta)).toBeNull();
    expect(validDefault(null, meta)).toBeNull();
  });

  it("adds the value to a page's filters, and nothing without a default", () => {
    const open: Filter = { field: "state", op: "in", values: ["open"] };
    const scope = validDefault("t1", meta);
    expect(withDefaultScope([open], [], scope)).toEqual([open, scopeFilter(scope!)]);
    expect(scopeFilter(scope!)).toEqual({ field: "dim:F_squad", op: "in", values: ["t1"] });
    expect(withDefaultScope([open], [], null)).toEqual([open]);
  });

  it("leaves a page alone when it already says something about that dimension", () => {
    const scope = validDefault("t1", meta);
    const mine: Filter = { field: "dim:F_squad", op: "in", values: ["t2"] };
    expect(withDefaultScope([mine], [], scope)).toEqual([mine]);
    expect(withDefaultScope([], [mine], scope)).toEqual([]);
    const either: Filter = { field: "any", filters: [{ field: "priority", op: "empty" }, { field: "dim:F_squad", op: "empty" }] };
    expect(withDefaultScope([], [either], scope)).toEqual([]);
  });
});
