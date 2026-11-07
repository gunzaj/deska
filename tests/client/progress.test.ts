// Parent issue progress (§4.4): GitHub's counts, shown as they are.
import { describe, expect, it } from "vitest";
import { progressKey, progressText, subProgress } from "@/lib/client/progress";

const issue = (subTotal: number | null, subCompleted: number | null, hasSubIssues = (subTotal ?? 0) > 0) => ({ subTotal, subCompleted, hasSubIssues });

describe("subProgress", () => {
  it("2 closed + 2 open children reads 50% · 2/4", () => {
    const p = subProgress(issue(4, 2));
    expect(p).toEqual({ kind: "counted", total: 4, done: 2, pct: 50 });
    expect(progressText(p)).toBe("50% · 2/4");
  });

  it("no children shows nothing: never 0% or 100%", () => {
    expect(subProgress(issue(0, 0))).toEqual({ kind: "none" });
    expect(progressText(subProgress(issue(0, 0)))).toBeNull();
    expect(progressKey(issue(0, 0))).toBeNull();
  });

  it("counts not read yet: 'progress not loaded' when children are known, nothing otherwise, never a number", () => {
    expect(progressText(subProgress(issue(null, null, true)))).toBe("— progress not loaded");
    expect(progressText(subProgress(issue(null, null, false)))).toBeNull();
    expect(progressKey(issue(null, null, true))).toBeNull();
  });

  it("rounds like GitHub and never exceeds the total", () => {
    expect(progressText(subProgress(issue(3, 1)))).toBe("33% · 1/3");
    expect(progressText(subProgress(issue(3, 2)))).toBe("67% · 2/3");
    expect(subProgress(issue(2, 5))).toMatchObject({ done: 2, pct: 100 });
  });

  it("sorts by the completed share, rows without counts last", () => {
    const keys = [issue(4, 1), issue(0, 0), issue(2, 2), issue(null, null, true)].map(progressKey);
    expect(keys).toEqual([0.25, null, 1, null]);
  });
});
