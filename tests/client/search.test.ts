import { describe, expect, it } from "vitest";
import { matchesCommand, scoreIssue, searchIssues } from "@/lib/client/search";

const NOW = Date.parse("2026-10-12T00:00:00Z");
const issue = (number: number, title: string, state = "open", updatedAt = "2026-10-10T00:00:00Z", labelNames: string[] = []) => ({ number, title, state, updatedAt, labelNames });

describe("palette issue search", () => {
  const issues = [
    issue(15143, "Warn when sending to an address used before"),
    issue(15014, "Send max ignores pending RBF transaction"),
    issue(1514, "Old send bug", "closed", "2025-01-01T00:00:00Z"),
    issue(16000, "Dashboard graph flickers", "open", "2026-10-11T00:00:00Z", ["UI"]),
  ];

  it("ranks the exact #number first, then number prefixes", () => {
    expect(searchIssues(issues, "#1514", 3, NOW).map((i) => i.number)).toEqual([1514, 15143]);
    expect(searchIssues(issues, "15143", 3, NOW).map((i) => i.number)).toEqual([15143]);
  });

  it("requires every word and prefers word starts and open issues", () => {
    expect(searchIssues(issues, "send", 5, NOW).map((i) => i.number)).toEqual([15014, 15143, 1514]);
    expect(searchIssues(issues, "send rbf", 5, NOW).map((i) => i.number)).toEqual([15014]);
    expect(scoreIssue(issues[0]!, "send missing", NOW)).toBe(-1);
  });

  it("matches labels and ignores accents", () => {
    expect(searchIssues(issues, "ui graph", 5, NOW).map((i) => i.number)).toEqual([16000]);
    expect(searchIssues([issue(1, "Účet se nenačte")], "ucet", 5, NOW)).toHaveLength(1);
  });

  it("matches commands by label or keywords", () => {
    expect(matchesCommand("Backlog", "", "back")).toBe(true);
    expect(matchesCommand("Use system theme", "appearance auto", "appear")).toBe(true);
    expect(matchesCommand("Backlog", "", "board")).toBe(false);
  });
});
