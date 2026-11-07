// Copy view / Import view (SPEC §4.2, D7): a view travels as a compact JSON
// string, with its field and option IDs inside.
import { beforeEach, describe, expect, it } from "vitest";
import { __resetViews, submitView, viewsFor } from "@/lib/views/runtime";
import { decodeView, encodeView } from "@/lib/views/share";
import { decodeViewState, encodeViewState } from "@/lib/views/url";
import type { View } from "@/lib/views/view";

const view: View = {
  id: "v-source",
  name: "Platform board",
  layout: "board",
  filters: [
    { field: "dim:PVTSSF_acme_team", op: "in", values: ["c0000001"] },
    { field: "state", op: "in", values: ["open"] },
    { field: "any", filters: [{ field: "assignee", op: "in", values: ["me"] }, { field: "created", op: "within_days", days: 7 }] },
  ],
  sort: [{ field: "priority", dir: "desc" }, { field: "updated", dir: "desc" }],
  groupBy: "dim:PVTSSF_acme_team",
  boardColumnsField: "status",
  columns: ["number", "title", "status"],
};

describe("copy and import a view", () => {
  beforeEach(() => __resetViews());

  it("a copied view is one line of JSON without the ID or any owner", () => {
    const text = encodeView(view);
    expect(text).not.toContain("\n");
    expect(text).not.toContain("v-source");
    expect(JSON.parse(text)).toMatchObject({ kind: "deska-view", v: 1, view: { name: "Platform board" } });
    expect(Object.keys(JSON.parse(text).view)).not.toEqual(expect.arrayContaining(["ownerId"]));
  });

  it("importing on a fresh install reproduces filters, sort, grouping and layout", async () => {
    const text = encodeView(view);
    __resetViews(); // a fresh install: nothing saved
    const r = decodeView(text);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const saved = await submitView({ ...r.view, id: "" });
    expect(saved.id).toMatch(/^v-/);
    expect(saved.id).not.toBe(view.id);
    const { id: _a, ...got } = (await viewsFor()).find((v) => v.id === saved.id)!;
    const { id: _b, ...want } = view;
    expect(got).toEqual(want);
    // The URL state the explorer opens with is the same too.
    expect(decodeViewState(encodeViewState(saved))).toEqual(decodeViewState(encodeViewState(view)));
  });

  it("refuses text that is not a view, with a reason", () => {
    for (const bad of ["", "hello", "[1,2]", "{}", JSON.stringify({ kind: "other", v: 1, view })]) {
      const r = decodeView(bad);
      expect(r.ok, bad).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/isn't a Deska view/);
    }
    expect(decodeView(JSON.stringify({ kind: "deska-view", v: 2, view: {} }))).toEqual({ ok: false, error: "This view comes from a different version of Deska." });
  });

  it("refuses a damaged view: unknown fields, unknown filter fields, too many filters, no name", () => {
    const wrap = (v: unknown) => JSON.stringify({ kind: "deska-view", v: 1, view: v });
    const { id: _id, ...base } = view;
    expect(decodeView(wrap({ ...base, ownerId: "bob" })).ok).toBe(false); // strict: no smuggled keys
    expect(decodeView(wrap({ ...base, filters: [{ field: "nope", op: "in" }] })).ok).toBe(false);
    expect(decodeView(wrap({ ...base, filters: Array.from({ length: 51 }, () => ({ field: "state", op: "in", values: ["open"] })) })).ok).toBe(false);
    expect(decodeView(wrap({ ...base, name: "  " }))).toEqual({ ok: false, error: "This view has no name." });
  });

  it("never takes the ID from the pasted text", () => {
    const wrap = JSON.stringify({ kind: "deska-view", v: 1, view: { ...view, id: "seed-epics" } });
    const r = decodeView(wrap);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.view).not.toHaveProperty("id");
  });
});
