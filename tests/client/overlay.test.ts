import { describe, expect, it } from "vitest";
import { applyWire } from "@/lib/client/edit";
import { composed, dropEdit, overlayKeys, pushEdit, settleEdit, type IssueOverlay } from "@/lib/client/overlay";
import type { WireIssue } from "@/lib/client/types";

const row = { id: "I_12", n: 12, t: "Widget crash", o: 1, au: "alice", c: "2026-11-01", u: "2026-11-02", lb: ["L_base"], st: "S_A" } as WireIssue;
const shownOf = (o: IssueOverlay | undefined) => (o ? applyWire(row, composed(o)) : row);

describe("overlapping optimistic edits to one issue", () => {
  it("label X fails while label Y is in flight: only X rolls back, and Y commits without X", () => {
    let o = pushEdit(undefined, row, { id: "x", field: "labels", next: { added: ["L_x"], removed: [] } });
    o = pushEdit(o, shownOf(o), { id: "y", field: "labels", next: { added: ["L_y"], removed: [] } });
    expect(shownOf(o).lb).toEqual(["L_base", "L_x", "L_y"]);
    const afterX = dropEdit(o, "x");
    expect(shownOf(afterX).lb).toEqual(["L_base", "L_y"]);
    const { overlay, committed } = settleEdit(afterX, "y");
    expect(committed).toEqual({ lb: ["L_base", "L_y"] });
    expect(overlay).toBeUndefined();
  });

  it("Status B answers 200 after Status C got 202: B goes into the row, C stays on top", () => {
    let o = pushEdit(undefined, row, { id: "b", field: "status", next: "S_B" });
    o = pushEdit(o, shownOf(o), { id: "c", field: "status", next: "S_C" });
    const { overlay, committed } = settleEdit(o, "b");
    expect(committed).toEqual({ st: "S_B" });
    expect(shownOf(overlay).st).toBe("S_C");
    expect(overlayKeys(overlay)).toEqual(["st"]);
  });

  it("an edit that empties a field clears the key over the base", () => {
    const o = pushEdit(undefined, row, { id: "a", field: "labels", next: { added: [], removed: ["L_base"] } });
    expect(composed(o)).toEqual({ lb: undefined });
    expect(shownOf(o).lb).toBeUndefined();
    expect(dropEdit(o, "a")).toBeUndefined();
  });
});
