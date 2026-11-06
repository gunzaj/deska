import { describe, expect, it } from "vitest";
import { releaseRisk } from "@/lib/client/risk";
import type { ClientIssue, ClientRelease } from "@/lib/client/types";

const release: ClientRelease = { id: "R1", title: "Sprint 22", startDate: "2026-10-01", endDate: "2026-11-01", duration: 31 };
const meta = (today: string) => ({ today, fields: { priority: [{ id: "low", name: "LOW", color: "" }, { id: "mid", name: "MID", color: "" }, { id: "high", name: "HIGH", color: "" }] } }) as never;

const issue = (n: number, over: Partial<ClientIssue> = {}): ClientIssue =>
  ({ nodeId: `I${n}`, number: n, title: `Issue ${n}`, state: "open", releaseId: "R1", priorityId: "high", assignees: ["alice"], ...over }) as ClientIssue;

const base = (today: string, issues: ClientIssue[], prs: string[] = [], added: string[] = []) =>
  releaseRisk({ issues, release, meta: meta(today), hasOpenPr: (id) => prs.includes(id), scopeAddedIds: added });

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

  it("flags top-priority issues with no open PR only in the last 7 days", () => {
    const issues = [issue(1), issue(2), issue(3, { priorityId: "low" })];
    expect(base("2026-10-20", issues).noPr).toBeNull();
    // 7 days left: 25 Oct to the exclusive end 1 Nov.
    const late = base("2026-10-25", issues, ["I2"]);
    expect(late.noPr?.map((i) => i.number)).toEqual([1]);
    expect(base("2026-10-31", issues).noPr?.map((i) => i.number)).toEqual([1, 2]);
    // Over: nothing in progress to check.
    expect(base("2026-11-02", issues).noPr).toBeNull();
  });

  it("scope added: the issues F0 saw set to this Release that are still in it; empty for issues present at start", () => {
    const issues = [issue(1), issue(2), issue(3, { releaseId: "R2" })];
    expect(base("2026-10-10", issues, [], []).scopeAdded).toEqual([]);
    expect(base("2026-10-10", issues, [], ["I2", "I3", "unknown"]).scopeAdded.map((i) => i.number)).toEqual([2]);
  });
});
