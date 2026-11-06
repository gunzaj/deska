import { beforeEach, describe, expect, it } from "vitest";
import { __resetViews, deleteView, duplicateView, saveView, viewsFor } from "@/lib/views/runtime";
import { decodeViewState, encodeViewState } from "@/lib/views/url";

describe("views persistence + URL state (M5)", () => {
  beforeEach(() => {
    __resetViews();
  });

  it("round-trips URL state", async () => {
    const [seed] = await viewsFor("alice");
    const qs = encodeViewState(seed!);
    expect(decodeViewState(qs)).toEqual({
      filters: seed!.filters,
      sort: seed!.sort,
      groupBy: seed!.groupBy,
    });
  });

  it("saves and duplicates views", async () => {
    const [seed] = await viewsFor("alice");
    const renamed = { ...seed!, name: "Renamed" };
    await saveView("alice", renamed);
    expect((await viewsFor("alice")).find((v) => v.id === seed!.id)?.name).toBe("Renamed");
    const copy = await duplicateView("alice", seed!.id, "Copy");
    expect(copy?.name).toBe("Copy");
    expect((await viewsFor("alice")).some((v) => v.id === copy!.id)).toBe(true);
  });

  it("shows another user's shared view but hides their personal one", async () => {
    const mine = (await viewsFor("alice"))[0]!;
    await saveView("alice", { ...mine, visibility: "personal" });
    await saveView("bob", { ...mine, id: "shared-by-bob", visibility: "shared" });
    await saveView("bob", { ...mine, id: "personal-by-bob", visibility: "personal" });

    const forAlice = await viewsFor("alice");
    expect(forAlice.some((v) => v.id === "shared-by-bob")).toBe(true);
    expect(forAlice.some((v) => v.id === "personal-by-bob")).toBe(false);
  });

  it("only the owner edits or deletes a shared view; others can duplicate it (Q6)", async () => {
    const base = (await viewsFor("alice"))[0]!;
    await saveView("bob", { ...base, id: "team-view", name: "Team", visibility: "shared" });
    expect(await saveView("alice", { ...base, id: "team-view", name: "Hijacked", visibility: "shared" })).toBeNull();
    expect(await deleteView("alice", "team-view")).toBe(false);
    expect((await viewsFor("alice")).find((v) => v.id === "team-view")?.name).toBe("Team");
    const copy = await duplicateView("alice", "team-view", "My copy");
    expect(copy).toMatchObject({ ownerId: "alice", visibility: "personal" });
    expect(await saveView("bob", { ...base, id: "team-view", name: "Renamed by owner", visibility: "shared" })).not.toBeNull();
  });

  it("refuses to duplicate a view the viewer cannot see", async () => {
    await viewsFor("alice");
    await saveView("bob", { ...(await viewsFor("bob"))[0]!, id: "secret", visibility: "personal" });
    expect(await duplicateView("alice", "secret", "stolen")).toBeNull();
  });

  it("matches view ownership case-insensitively", async () => {
    const base = (await viewsFor("alice"))[0]!;
    await saveView("Bob", { ...base, id: "bob-personal", name: "Mine", visibility: "personal" });
    expect((await viewsFor("bob")).some((v) => v.id === "bob-personal")).toBe(true);
    expect(await saveView("bob", { ...base, id: "bob-personal", name: "Updated", visibility: "personal" })).not.toBeNull();
    expect(await deleteView("BOB", "bob-personal")).toBe(true);
  });
});