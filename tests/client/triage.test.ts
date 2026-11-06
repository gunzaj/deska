import { describe, expect, it } from "vitest";
import { addDaysIso, isSnoozed, priorityByKey, snoozePresets, withoutSnoozed } from "@/lib/client/triage";

describe("triage helpers (F3)", () => {
  it("a snooze hides an issue until its date, and it is back on that day", () => {
    expect(isSnoozed("2026-10-14", "2026-10-13")).toBe(true);
    expect(isSnoozed("2026-10-14", "2026-10-14")).toBe(false);
    expect(isSnoozed("2026-10-14", "2026-10-20")).toBe(false);
    expect(isSnoozed(undefined, "2026-10-13")).toBe(false);
  });

  it("filters a queue by the snoozes, leaving the order alone", () => {
    const rows = [{ nodeId: "a" }, { nodeId: "b" }, { nodeId: "c" }];
    const snoozes = new Map([["b", "2026-10-20"], ["c", "2026-10-13"]]);
    expect(withoutSnoozed(rows, snoozes, "2026-10-13").map((r) => r.nodeId)).toEqual(["a", "c"]);
    expect(withoutSnoozed(rows, snoozes, "2026-10-20").map((r) => r.nodeId)).toEqual(["a", "b", "c"]);
  });

  it("offers snooze dates from the viewer's today", () => {
    // 2026-10-13 is a Tuesday: next Monday is the 19th.
    expect(snoozePresets("2026-10-13").map((p) => p.until)).toEqual(["2026-10-14", "2026-10-16", "2026-10-19", "2026-10-27"]);
    // A Sunday's next Monday is the next day; a Monday's is a week on.
    expect(snoozePresets("2026-10-18")[2]!.until).toBe("2026-10-19");
    expect(snoozePresets("2026-10-19")[2]!.until).toBe("2026-10-26");
    expect(addDaysIso("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("maps keys 1-4 to Priority options by rank, 1 being the highest", () => {
    const meta = { fields: { priority: ["low", "mid", "high", "urgent", "blocker"].map((id) => ({ id, name: id, color: "" })) } } as never;
    expect(priorityByKey(meta).map((p) => p.id)).toEqual(["blocker", "urgent", "high", "mid"]);
    expect(priorityByKey({ fields: { priority: [{ id: "x", name: "x", color: "" }] } } as never).map((p) => p.id)).toEqual(["x"]);
  });
});
