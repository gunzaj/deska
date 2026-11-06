import { beforeEach, describe, expect, it } from "vitest";
import { __resetViews, deleteView, saveView, viewsFor } from "@/lib/views/runtime";
import type { View } from "@/lib/views/view";

const view = (filters: View["filters"]): View => ({
  id: "t",
  name: "t",
  ownerId: "alice",
  visibility: "personal",
  layout: "list",
  filters,
  sort: [],
});

describe("saved views store", () => {
  beforeEach(() => __resetViews());

  it("refuses to overwrite or delete another user's personal view", async () => {
    await viewsFor("bob");
    await saveView("bob", { ...view([]), id: "mine", ownerId: "bob" });
    expect(await saveView("alice", { ...view([]), id: "mine", name: "hijack" })).toBeNull();
    expect(await deleteView("alice", "mine")).toBe(false);
    expect(await deleteView("bob", "mine")).toBe(true);
  });

  it("keeps a shared view's owner: only they can edit it (SPEC §14, Q6)", async () => {
    await saveView("bob", { ...view([]), id: "shared", ownerId: "bob", visibility: "shared" });
    expect(await saveView("alice", { ...view([]), id: "shared", name: "Renamed", visibility: "shared" })).toBeNull();
    const shared = (await viewsFor("alice")).find((v) => v.id === "shared");
    expect(shared?.ownerId).toBe("bob");
    expect(shared?.name).not.toBe("Renamed");
  });
});
