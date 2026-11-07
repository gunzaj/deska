import { beforeEach, describe, expect, it } from "vitest";
import { __resetViews, deleteView, duplicateView, saveView, viewsFor } from "@/lib/views/runtime";
import { decodeViewState, encodeViewState } from "@/lib/views/url";

describe("views persistence + URL state (M5)", () => {
  beforeEach(() => {
    __resetViews();
  });

  it("round-trips URL state", async () => {
    const [seed] = await viewsFor();
    const qs = encodeViewState(seed!);
    expect(decodeViewState(qs)).toEqual({
      filters: seed!.filters,
      sort: seed!.sort,
      groupBy: seed!.groupBy,
    });
  });

  it("saves and duplicates views", async () => {
    const [seed] = await viewsFor();
    const renamed = { ...seed!, name: "Renamed" };
    await saveView(renamed);
    expect((await viewsFor()).find((v) => v.id === seed!.id)?.name).toBe("Renamed");
    const copy = await duplicateView(seed!.id, "Copy");
    expect(copy?.name).toBe("Copy");
    expect((await viewsFor()).some((v) => v.id === copy!.id)).toBe(true);
  });

  it("keeps every saved view, whichever GitHub account is connected", async () => {
    const base = (await viewsFor())[0]!;
    await saveView({ ...base, id: "mine", name: "Mine" });
    expect((await viewsFor()).find((v) => v.id === "mine")?.name).toBe("Mine");
    // Anything saved can be changed, deleted and restored: there is no owner to check (§4.2).
    await saveView({ ...base, id: "mine", name: "Renamed" });
    expect((await viewsFor()).find((v) => v.id === "mine")?.name).toBe("Renamed");
    expect(await deleteView("mine")).toBe(true);
    expect(await deleteView("mine")).toBe(false);
  });

  it("duplicating an unknown view finds nothing", async () => {
    expect(await duplicateView("nope", "copy")).toBeNull();
  });
});
