import { describe, expect, it } from "vitest";
import { describeFieldChange } from "@/lib/client/watch";
import { setValue } from "@/lib/sync/changes";

const meta = {
  fields: {
    status: [{ id: "s1", name: "📋 To do", color: "" }, { id: "s2", name: "🏃 In progress", color: "" }],
    priority: [{ id: "p1", name: "LOW", color: "" }],
    team: [{ id: "t1", name: "Core", color: "" }],
    platform: [],
  },
  releases: [{ id: "r1", title: "Sprint 23" }],
  labels: [{ id: "l1", name: "ui" }, { id: "l2", name: "bug" }],
} as never;

describe("watch change lines (F6)", () => {
  it("names options and releases instead of IDs", () => {
    expect(describeFieldChange(meta, { field: "status", oldValue: "s1", newValue: "s2" }).text).toBe("📋 To do → 🏃 In progress");
    expect(describeFieldChange(meta, { field: "release", oldValue: null, newValue: "r1" }).text).toBe("none → Sprint 23");
    expect(describeFieldChange(meta, { field: "state", oldValue: "open", newValue: "closed" })).toMatchObject({ label: "State", text: "open → closed" });
  });

  it("says what was added and removed for labels and assignees", () => {
    expect(describeFieldChange(meta, { field: "labels", oldValue: setValue(["l1"]), newValue: setValue(["l2"]) }).text).toBe("added bug, removed ui");
    expect(describeFieldChange(meta, { field: "assignees", oldValue: setValue([]), newValue: setValue(["bob"]) }).text).toBe("added bob");
  });

  it("copes with options that were removed", () => {
    expect(describeFieldChange(meta, { field: "priority", oldValue: "gone", newValue: "p1" }).text).toBe("a removed option → LOW");
  });
});
