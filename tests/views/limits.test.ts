// v5 2.6: saved views and edits are bounded, strict, and the server makes new IDs.
import { describe, expect, it } from "vitest";
import { editSchema } from "@/lib/outbox/edit";
import { VIEW_LIMITS, viewSchema } from "@/lib/views/view";

const base = { id: "v-1", name: "Mine", layout: "list", filters: [], sort: [] };

describe("view limits", () => {
  it("accepts a reasonable view", () => {
    const view = {
      ...base,
      filters: [
        { field: "status", op: "in", values: ["a", "b"] },
        { field: "any", filters: [{ field: "text", op: "contains", value: "crash" }] },
      ],
      sort: [{ field: "updated", dir: "desc" }],
      columns: ["number", "title"],
    };
    expect(viewSchema.safeParse(view).success).toBe(true);
  });

  it.each([
    ["a long name", { name: "x".repeat(VIEW_LIMITS.name + 1) }],
    ["a long id", { id: "x".repeat(VIEW_LIMITS.id + 1) }],
    ["too many filters", { filters: Array.from({ length: VIEW_LIMITS.filters + 1 }, () => ({ field: "status", op: "empty" })) }],
    ["too many values", { filters: [{ field: "label", op: "in", values: Array.from({ length: VIEW_LIMITS.values + 1 }, (_, i) => String(i)) }] }],
    ["a huge value", { filters: [{ field: "label", op: "in", values: ["x".repeat(VIEW_LIMITS.value + 1)] }] }],
    ["a huge text filter", { filters: [{ field: "text", op: "contains", value: "x".repeat(VIEW_LIMITS.text + 1) }] }],
    ["too many sort keys", { sort: Array.from({ length: VIEW_LIMITS.sort + 1 }, () => ({ field: "updated", dir: "asc" })) }],
    ["too many columns", { columns: Array.from({ length: VIEW_LIMITS.columns + 1 }, () => "c") }],
    ["too many OR filters", { filters: [{ field: "any", filters: Array.from({ length: VIEW_LIMITS.anyFilters + 1 }, () => ({ field: "status", op: "empty" })) }] }],
    ["an unknown top-level key", { extra: 1 }],
    ["an unknown filter key", { filters: [{ field: "status", op: "empty", junk: true }] }],
  ])("rejects %s", (_name, over) => {
    expect(viewSchema.safeParse({ ...base, ...over }).success).toBe(false);
  });
});

describe("edit body", () => {
  it("takes a string, null or no base, and nothing structured", () => {
    expect(editSchema.safeParse({ field: "priority", next: "x", base: "y" }).success).toBe(true);
    expect(editSchema.safeParse({ field: "priority", next: "x", base: null }).success).toBe(true);
    expect(editSchema.safeParse({ field: "priority", next: "x" }).success).toBe(true);
    expect(editSchema.safeParse({ field: "priority", next: "x", base: { a: 1 } }).success).toBe(false);
    expect(editSchema.safeParse({ field: "priority", next: "x", base: "y".repeat(201) }).success).toBe(false);
  });
});
