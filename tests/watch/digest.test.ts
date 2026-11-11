import { beforeEach, describe, expect, it } from "vitest";
import { getStore } from "@/lib/store";
import { notificationsFor, setPrefs } from "@/lib/tasks/service";
import { __resetDigestChecks, fireWatchDigest } from "@/lib/watch/digest";
import { addWatch, removeWatch } from "@/lib/watch/repo";
import { saveView } from "@/lib/views/runtime";

// F6: the daily digest in the bell, on the in-memory stores.

const LOGIN = "digest-user";
const VIEW_LOGIN = "digest-view-user";
const issueNode = "I_bug";

async function change(at: Date) {
  (await getStore()).fieldChanges.push({ issueNodeId: issueNode, field: "status", oldValue: "a", newValue: "b", observedAt: at.toISOString(), source: "sync" });
}

describe("watch digest (F6)", () => {
  beforeEach(async () => {
    __resetDigestChecks();
    (await getStore()).fieldChanges.length = 0;
    await removeWatch(LOGIN, "issue", issueNode);
    await removeWatch(VIEW_LOGIN, "view", "v-digest");
  });

  it("does nothing without watches, or when nothing changed", async () => {
    expect(await fireWatchDigest(LOGIN, new Date())).toBe(false);
    await addWatch(LOGIN, "issue", issueNode, new Date("2026-10-13T08:00:00Z"));
    expect(await fireWatchDigest(LOGIN, new Date("2026-10-13T12:00:00Z"))).toBe(false);
    expect((await notificationsFor(LOGIN, new Date("2026-10-13T12:20:00Z"))).list.filter((n) => n.kind === "watch_digest")).toEqual([]);
  });

  it("adds one bell entry a day when watched items changed, with no task attached", async () => {
    await addWatch(LOGIN, "issue", issueNode, new Date("2026-10-13T08:00:00Z"));
    await change(new Date("2026-10-13T09:00:00Z"));
    const morning = new Date("2026-10-13T12:00:00Z");
    expect(await fireWatchDigest(LOGIN, morning)).toBe(true);
    // Checked again later the same day: the dedupe key holds.
    expect(await fireWatchDigest(LOGIN, new Date("2026-10-13T20:00:00Z"))).toBe(false);
    const { list, unread } = await notificationsFor(LOGIN, new Date("2026-10-13T20:30:00Z"));
    const digests = list.filter((n) => n.kind === "watch_digest");
    expect(digests).toHaveLength(1);
    expect(digests[0]).toMatchObject({ taskId: null, title: "1 watched item changed" });
    expect(unread).toBeGreaterThanOrEqual(1);
    // Tomorrow, the change still unseen: a new day, a new entry.
    expect(await fireWatchDigest(LOGIN, new Date("2026-10-14T12:00:00Z"))).toBe(true);
  });

  it("counts a day in the viewer's own time zone, not UTC (v5 4.9)", async () => {
    await setPrefs(LOGIN, { tz: "Pacific/Auckland" });
    try {
      await addWatch(LOGIN, "issue", issueNode, new Date("2026-10-20T08:00:00Z"));
      await change(new Date("2026-10-20T09:00:00Z"));
      // 20:00 UTC on the 20th is already the 21st in Auckland (UTC+13) ...
      expect(await fireWatchDigest(LOGIN, new Date("2026-10-20T20:00:00Z"))).toBe(true);
      // ... and 02:00 UTC on the 21st is still that same Auckland day, so no second entry.
      expect(await fireWatchDigest(LOGIN, new Date("2026-10-21T02:00:00Z"))).toBe(false);
    } finally {
      await setPrefs(LOGIN, { tz: null });
    }
  });

  it("covers a watched view: one digest for the changes on the issues it matches, not one per change", async () => {
    await saveView({ id: "v-digest", name: "Everything", layout: "list", filters: [], sort: [] });
    await addWatch(VIEW_LOGIN, "view", "v-digest", new Date("2026-10-25T08:00:00Z"));
    await change(new Date("2026-10-25T09:00:00Z"));
    expect(await fireWatchDigest(VIEW_LOGIN, new Date("2026-10-25T12:00:00Z"))).toBe(true);
    const digests = (await notificationsFor(VIEW_LOGIN, new Date("2026-10-25T12:30:00Z"))).list.filter((n) => n.kind === "watch_digest");
    expect(digests).toHaveLength(1);
    expect(digests[0]).toMatchObject({ taskId: null, title: "1 watched item changed" });
    // A second change the same day is covered by the same entry.
    await change(new Date("2026-10-25T13:00:00Z"));
    expect(await fireWatchDigest(VIEW_LOGIN, new Date("2026-10-25T14:00:00Z"))).toBe(false);
    expect((await notificationsFor(VIEW_LOGIN, new Date("2026-10-25T14:30:00Z"))).list.filter((n) => n.kind === "watch_digest")).toHaveLength(1);
  });

  it("is not made for someone else's watches", async () => {
    await addWatch(LOGIN, "issue", issueNode, new Date("2026-10-13T08:00:00Z"));
    await change(new Date("2026-10-13T09:00:00Z"));
    expect(await fireWatchDigest("someone-else", new Date("2026-10-13T12:00:00Z"))).toBe(false);
  });

  it("does not throttle a user who just added their first watch", async () => {
    const t0 = new Date("2026-10-15T10:00:00Z");
    // Poll before watching anything: must not block the digest when a watch is added 1 min later.
    expect(await fireWatchDigest(LOGIN, t0)).toBe(false);
    await addWatch(LOGIN, "issue", issueNode, new Date("2026-10-15T08:00:00Z"));
    await change(new Date("2026-10-15T09:00:00Z"));
    expect(await fireWatchDigest(LOGIN, new Date("2026-10-15T10:01:00Z"))).toBe(true);
  });
});
