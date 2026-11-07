import { describe, expect, it } from "vitest";
import { releaseRisk } from "@/lib/client/risk";
import type { ClientIssue, ClientRelease } from "@/lib/client/types";

const release: ClientRelease = { id: "R1", title: "Sprint 22", startDate: "2026-10-01", endDate: "2026-11-01", duration: 31 };
const meta = (today: string) => ({ today, fields: { priority: [{ id: "low", name: "LOW", color: "" }, { id: "mid", name: "MID", color: "" }, { id: "high", name: "HIGH", color: "" }] } }) as never;

const issue = (n: number, over: Partial<ClientIssue> = {}): ClientIssue =>
  ({ nodeId: `I${n}`, number: n, title: `Issue ${n}`, state: "open", releaseId: "R1", priorityId: "high", assignees: ["alice"], ...over }) as ClientIssue;

const base = (today: string, issues: ClientIssue[], added: string[] = []) => releaseRisk({ issues, release, meta: meta(today), scopeAddedIds: added });

describe("release risk (F2)", () => {
  it("flags open top-priority issues with no assignee, and only those", () => {
    const risk = base("2026-10-10", [
      issue(1, { assignees: [] }),
      issue(2),
      issue(3, { assignees: [], priorityId: "mid" }),
      issue(4, { assignees: [], state: "closed" }),
      issue(5, { assignees: [], releaseId: "R2" }),
    ]);
    expect(risk.noOwner.map((i) => i.number)).toEqual([1]);
    expect(risk.topPriorityId).toBe("high");
  });

  it("has no pull request rule any more (D6)", () => {
    expect(Object.keys(base("2026-10-31", [issue(1)])).sort()).toEqual(["noOwner", "scopeAdded", "topPriorityId"]);
  });

  it("scope added: the issues F0 saw set to this Release that are still in it; empty for issues present at start", () => {
    const issues = [issue(1), issue(2), issue(3, { releaseId: "R2" })];
    expect(base("2026-10-10", issues, []).scopeAdded).toEqual([]);
    expect(base("2026-10-10", issues, ["I2", "I3", "unknown"]).scopeAdded.map((i) => i.number)).toEqual([2]);
  });
});
