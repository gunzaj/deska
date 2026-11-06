import { describe, expect, it } from "vitest";
import { groupPrs, matchPr, prStateKey, requestedFrom, runPrs } from "@/lib/client/prs";
import type { ClientPr } from "@/lib/client/types";
import { viewSchema } from "@/lib/views/view";

function pr(p: Partial<ClientPr>): ClientPr {
  return {
    nodeId: `PR_${p.number ?? 1}`,
    number: 1,
    title: "Fix send flow",
    state: "open",
    isDraft: false,
    author: "bob",
    url: "",
    headRef: "fix/send",
    baseRef: "develop",
    reviewDecision: null,
    checksState: "SUCCESS",
    milestoneId: null,
    additions: 1,
    deletions: 1,
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-05T00:00:00Z",
    closedAt: null,
    mergedAt: null,
    labelIds: [],
    assignees: [],
    reviewRequests: [],
    reviews: [],
    closingIssues: [],
    ...p,
  };
}
const c = { me: "alice", myTeams: ["core"] };

describe("PR filters (§13.3)", () => {
  const draft = pr({ number: 2, isDraft: true });
  const merged = pr({ number: 3, state: "merged" });
  it("state: open, draft, merged, closed", () => {
    expect(prStateKey(draft)).toBe("draft");
    expect(matchPr(draft, { field: "state", values: ["open"] }, c)).toBe(false);
    expect(matchPr(merged, { field: "state", values: ["merged", "closed"] }, c)).toBe(true);
  });
  it("author and assignee, with me (case-insensitive on both sides)", () => {
    expect(matchPr(pr({ author: "alice" }), { field: "author", values: ["me"] }, c)).toBe(true);
    expect(matchPr(pr({ author: "Alice" }), { field: "author", values: ["me"] }, c)).toBe(true);
    expect(matchPr(pr({ author: "Bob" }), { field: "author", values: ["bob"] }, c)).toBe(true);
    expect(matchPr(pr({}), { field: "author", values: ["Bob"] }, c)).toBe(true);
    expect(matchPr(pr({ assignees: ["alice"] }), { field: "assignee", values: ["me"] }, c)).toBe(true);
    expect(matchPr(pr({ assignees: ["Alice"] }), { field: "assignee", values: ["me"] }, c)).toBe(true);
    expect(matchPr(pr({ assignees: ["Bob"] }), { field: "assignee", values: ["bob"] }, c)).toBe(true);
  });
  it("review requested: me directly or through my team; a named user; a team", () => {
    const direct = pr({ reviewRequests: [{ kind: "user", reviewer: "Alice" }] });
    const team = pr({ reviewRequests: [{ kind: "team", reviewer: "Core" }] });
    const other = pr({ reviewRequests: [{ kind: "team", reviewer: "Checkout" }] });
    expect(requestedFrom(direct, c)).toBe(true);
    expect(requestedFrom(team, c)).toBe(true);
    expect(requestedFrom(other, c)).toBe(false);
    expect(matchPr(other, { field: "requested", values: ["team:checkout"] }, c)).toBe(true);
    expect(matchPr(direct, { field: "requested", values: ["alice"] }, c)).toBe(true);
    expect(matchPr(direct, { field: "requested", values: ["bob"] }, c)).toBe(false);
  });
  it("reviewed by, decision, checks, label, milestone, linked, text", () => {
    const p = pr({ number: 1234, reviews: [{ author: "Alice", state: "APPROVED", submittedAt: null }], reviewDecision: "APPROVED", checksState: "ERROR", labelIds: ["L1"], milestoneId: "M1", closingIssues: ["I_1"] });
    expect(matchPr(p, { field: "reviewedBy", values: ["me"] }, c)).toBe(true);
    expect(matchPr(p, { field: "reviewedBy", values: ["alice"] }, c)).toBe(true);
    expect(matchPr(p, { field: "decision", values: ["APPROVED"] }, c)).toBe(true);
    expect(matchPr(pr({}), { field: "decision", values: ["none"] }, c)).toBe(true);
    expect(matchPr(p, { field: "checks", values: ["FAILURE"] }, c)).toBe(true);
    expect(matchPr(p, { field: "label", values: ["L1"] }, c)).toBe(true);
    expect(matchPr(p, { field: "milestone", values: ["M1"] }, c)).toBe(true);
    expect(matchPr(p, { field: "linked", values: ["yes"] }, c)).toBe(true);
    expect(matchPr(p, { field: "text", value: "#1234" }, c)).toBe(true);
    expect(matchPr(p, { field: "text", value: "send" }, c)).toBe(true);
  });
});

describe("running, grouping and saving", () => {
  const rows = [pr({ number: 1, updatedAt: "2026-10-01T00:00:00Z", checksState: "FAILURE" }), pr({ number: 2, updatedAt: "2026-10-09T00:00:00Z", reviewDecision: "APPROVED" }), pr({ number: 3, state: "closed" })];
  it("filters with AND and sorts by updated desc", () => {
    const out = runPrs(rows, { filters: [{ field: "state", values: ["open"] }], sort: "updated", dir: "desc" }, c);
    expect(out.map((p) => p.number)).toEqual([2, 1]);
  });
  it("groups by checks with failing first", () => {
    expect(groupPrs(rows, "checks", (id) => id).map((g) => g.key)).toEqual(["FAILURE", "SUCCESS"]);
    expect(groupPrs(rows, "decision", (id) => id).map((g) => g.key)).toEqual(["APPROVED", "none"]);
  });
  it("PR views validate as saved views with entity pr", () => {
    const ok = viewSchema.safeParse({
      id: "v1", name: "Waiting on me", ownerId: "alice", visibility: "personal", layout: "list", filters: [], sort: [], entity: "pr",
      pr: { filters: [{ field: "requested", values: ["me"] }], sort: "updated", dir: "desc", groupBy: "", layout: "list" },
    });
    expect(ok.success).toBe(true);
  });
});
