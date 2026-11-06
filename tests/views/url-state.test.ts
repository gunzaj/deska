import { describe, expect, it } from "vitest";
import { decodeViewState, encodeViewState } from "@/lib/views/url";

describe("view URL state decoding", () => {
  const saved = { filters: [], sort: [{ field: "updated", dir: "desc" as const }] };

  it("round-trips valid state", () => {
    const qs = encodeViewState(saved);
    expect(decodeViewState(qs, saved)).toEqual(saved);
  });

  it("falls back per-field instead of throwing on malformed JSON", () => {
    // Regression: JSON.parse threw on a hand-edited URL, producing a 500.
    // The bad field falls back to the saved value; the good one is honoured.
    expect(decodeViewState("filters=notjson&sort=[]", saved)).toEqual({
      ...saved,
      sort: [],
    });
    expect(decodeViewState("filters=%7B%22field%22", saved)).toEqual({
      ...saved,
      filters: [],
    });
  });

  it("falls back when the shape is invalid (unknown field)", () => {
    const qs = encodeURIComponent(
      JSON.stringify([{ field: "nonsense", op: "in", values: [] }]),
    );
    expect(decodeViewState(`filters=${qs}`, saved)).toEqual(saved);
  });

  it("falls back when the query string is empty", () => {
    expect(decodeViewState("", saved)).toEqual(saved);
  });
});

describe("view URL state: removed grouping", () => {
  it("round-trips a removed grouping instead of restoring the saved one", () => {
    const saved = { filters: [], sort: [], groupBy: "team" };
    const qs = encodeViewState({ filters: [], sort: [] });
    expect(decodeViewState(qs, saved).groupBy).toBeUndefined();
    expect(decodeViewState(encodeViewState(saved), { filters: [], sort: [] }).groupBy).toBe("team");
  });
});
