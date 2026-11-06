import { beforeEach, describe, expect, it } from "vitest";
import { getStore } from "@/lib/store";
import { collectWatchChanges } from "@/lib/watch/changes";
import { addWatch, removeWatch } from "@/lib/watch/repo";

// F6: a watcher may only read change history for the items they watch. The set of
// issues a watch covers is computed on the server; the client cannot widen it by
// sending extra node IDs.

const LOGIN = "watch-changes-user";
const WATCHED = "I_watched";
const OTHER = "I_other";

async function change(nodeId: string, at: string) {
  (await getStore()).fieldChanges.push({ issueNodeId: nodeId, field: "status", oldValue: "a", newValue: "b", observedAt: at, source: "sync" });
}

describe("collectWatchChanges (F6)", () => {
  beforeEach(async () => {
    (await getStore()).fieldChanges.length = 0;
    await removeWatch(LOGIN, "issue", WATCHED);
    await removeWatch(LOGIN, "issue", OTHER);
  });

  it("ignores node IDs the client sends for an issue watch", async () => {
    await addWatch(LOGIN, "issue", WATCHED, new Date("2026-10-13T08:00:00Z"));
    await change(WATCHED, "2026-10-13T09:00:00Z");
    await change(OTHER, "2026-10-13T09:30:00Z");

    // The client claims its watch covers both issues (raw JSON the type no longer allows).
    const items = [{ kind: "issue", targetId: WATCHED, nodeIds: [WATCHED, OTHER] }] as unknown as Parameters<typeof collectWatchChanges>[1];
    const got = await collectWatchChanges(LOGIN, items);
    expect(Object.keys(got)).toEqual([`issue:${WATCHED}`]);
    expect(got[`issue:${WATCHED}`]!.map((c) => c.issueNodeId)).toEqual([WATCHED]);
  });

  it("ignores watches that are not the login's", async () => {
    const got = await collectWatchChanges(LOGIN, [{ kind: "issue", targetId: OTHER }]);
    expect(got).toEqual({});
  });
});

describe("watchCoverage of a PR view (v5 4.6)", () => {
  it("covers no issues: a PR view has no issue field changes, and its empty filters must not mean 'every issue'", async () => {
    const { saveView } = await import("@/lib/views/runtime");
    const { watchCoverage } = await import("@/lib/watch/changes");
    const login = "pr-view-watcher";
    await saveView(login, {
      id: "pr-view-1",
      name: "Merged PRs",
      ownerId: login,
      visibility: "personal",
      layout: "list",
      filters: [],
      sort: [],
      entity: "pr",
      pr: { filters: [{ field: "state", values: ["merged"] }], sort: "updated", dir: "desc", groupBy: "", layout: "list" },
    });
    const w = { kind: "view" as const, targetId: "pr-view-1", userId: login, seenAt: new Date(0).toISOString(), createdAt: new Date(0).toISOString() };
    const cover = await watchCoverage(login, [w as never]);
    expect(cover.get("view:pr-view-1")).toEqual([]);
  });
});
