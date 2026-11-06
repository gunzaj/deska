// P1: PR sync (SPEC §13.1) on the in-memory store, with fake sources.
import { describe, expect, it } from "vitest";
import { prScanDue, scanPullRequests } from "@/lib/sync/cycle";
import { EMPTY_FIELD_MAP } from "@/lib/sync/field-map";
import { importFull } from "@/lib/sync/import";
import { MapKv, pollOnce } from "@/lib/sync/poll";
import { GitHubSource } from "@/lib/sync/source-github";
import { MemoryStore } from "@/lib/sync/store-memory";
import type { SnapshotPullRequest } from "@/lib/sync/types";
import { fixtureSnapshot } from "../fixtures/github";

const NOW = "2026-10-12T12:00:00Z";
const pr = (n: number) => fixtureSnapshot().pullRequests!.find((p) => p.number === n)!;

describe("PR import", () => {
  it("imports PRs and team members; a second identical run changes nothing", async () => {
    const store = new MemoryStore();
    const first = await importFull(fixtureSnapshot(), store);
    expect(first.updated).toBe(0);
    expect(store.pullRequests.size).toBe(3);
    expect(store.pullRequests.get("PR_104")).toMatchObject({ state: "merged", closingIssueNodeIds: ["I_sub"] });
    expect(store.teams.get("core")).toEqual(["alice"]);
    const again = await importFull(fixtureSnapshot(), store);
    expect(again).toEqual({ inserted: 0, updated: 0, unchanged: expect.any(Number) });
  });

  it("set order never counts as a change", async () => {
    const store = new MemoryStore();
    const p = pr(103);
    await importFull({ ...fixtureSnapshot(), pullRequests: [p] }, store);
    const shuffled = { ...p, reviewRequests: [...p.reviewRequests].reverse() };
    expect(await store.upsertPullRequest(shuffled)).toBe("unchanged");
  });
});

describe("PR polling and rescans", () => {
  it("a PR from the issues change check is applied within one cycle", async () => {
    const store = new MemoryStore();
    const kv = new MapKv();
    kv.set("issues.since", "2026-10-01T00:00:00Z");
    const merged: SnapshotPullRequest = { ...pr(103), state: "merged", mergedAt: NOW, closedAt: NOW };
    const res = await pollOnce({ checkChanges: async () => ({ kind: "changed", issues: [], items: [], pullRequests: [merged], etag: "e", since: NOW }) }, store, kv, NOW);
    expect(res).toMatchObject({ applied: true, inserted: 1 });
    expect(store.pullRequests.get("I_pr")?.state).toBe("merged");
  });

  it("the open-PR rescan picks up a new review request and records when it ran", async () => {
    const store = new MemoryStore();
    const kv = new MapKv();
    await importFull(fixtureSnapshot(), store);
    const requested: SnapshotPullRequest = { ...pr(105), reviewRequests: [{ kind: "user", reviewer: "alice" }, { kind: "team", reviewer: "checkout" }] };
    const source = {
      scanOpenPullRequests: async () => [requested],
      teamMembers: async (slugs: string[]) => slugs.map((slug) => ({ slug, members: ["Bob"] })),
    };
    expect(prScanDue(kv)).toBe(true);
    const res = await scanPullRequests(source, store, kv, NOW);
    expect(res).toMatchObject({ prs: 1, updated: 1 });
    expect(store.pullRequests.get("PR_105")?.reviewRequests).toContainEqual({ kind: "team", reviewer: "checkout" });
    expect(store.teams.get("checkout")).toEqual(["bob"]);
    expect(prScanDue(kv, Date.parse(NOW) + 1000)).toBe(false);
  });
});

describe("GitHub PR mapping", () => {
  it("maps state, reviews, checks and same-repo closing references", async () => {
    const source = new GitHubSource("t", { labelId: (n) => `L:${n}`, userId: (l) => `U:${l}`, milestoneId: (n) => `M${n}` }, EMPTY_FIELD_MAP);
    const node = {
      id: "PR_1", number: 9, title: "t", body: null, state: "MERGED", isDraft: false, mergedAt: NOW, closedAt: NOW, createdAt: NOW, updatedAt: NOW,
      url: "u", author: { login: "Bob" }, headRefName: "h", baseRefName: "develop", reviewDecision: "APPROVED", additions: 1, deletions: 2,
      milestone: { number: 3 }, assignees: { nodes: [{ login: "alice" }] }, labels: { nodes: [{ name: "UI" }] },
      reviewRequests: { nodes: [{ requestedReviewer: { __typename: "User", login: "Alice" } }, { requestedReviewer: { __typename: "Team", slug: "core" } }, { requestedReviewer: null }] },
      latestReviews: { nodes: [{ author: { login: "Bob" }, state: "APPROVED", submittedAt: NOW }] },
      commits: { nodes: [{ commit: { statusCheckRollup: { state: "SUCCESS" } } }] },
      closingIssuesReferences: { nodes: [{ id: "I_1", repository: { nameWithOwner: "acme/widgets" } }, { id: "I_x", repository: { nameWithOwner: "acme/gadgets" } }] },
    };
    (source as unknown as { gql: unknown }).gql = async () => ({ nodes: [node, null] });
    const [p] = await source.fetchPullRequests(["PR_1", "gone"]);
    expect(p).toMatchObject({
      state: "merged",
      milestoneId: "M3",
      labelIds: ["L:UI"],
      assigneeIds: ["U:alice"],
      checksState: "SUCCESS",
      reviewRequests: [{ kind: "user", reviewer: "alice" }, { kind: "team", reviewer: "core" }],
      reviews: [{ author: "bob", state: "APPROVED", submittedAt: NOW }],
      closingIssueNodeIds: ["I_1"],
    });
  });
});
