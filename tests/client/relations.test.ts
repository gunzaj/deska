import { describe, expect, it } from "vitest";
import { searchIssues, selfAndAncestors, selfAndDescendants } from "@/lib/client/relations";
import type { ClientIssue } from "@/lib/client/types";

const issue = (number: number, title: string, extra: Partial<ClientIssue> = {}): ClientIssue =>
  ({ nodeId: `I_${number}`, number, title, state: "open", updatedAt: `2026-01-${String(number % 28 + 1).padStart(2, "0")}T00:00:00Z`, parentNodeId: null, ...extra }) as ClientIssue;

const ISSUES = [
  issue(1, "Epic: billing"),
  issue(12, "Add a webhook", { parentNodeId: "I_1" }),
  issue(120, "Webhook retries", { parentNodeId: "I_12" }),
  issue(7, "Old webhook bug", { state: "closed" }),
];

describe("searchIssues", () => {
  it("matches by number prefix, exact number first", () => {
    expect(searchIssues(ISSUES, "#12", new Set()).map((i) => i.number)).toEqual([12, 120]);
    expect(searchIssues(ISSUES, "12", new Set()).map((i) => i.number)[0]).toBe(12);
  });

  it("matches every word of the title, open issues first, and leaves out excluded ones", () => {
    expect(searchIssues(ISSUES, "webhook", new Set()).map((i) => i.number)).toEqual([12, 120, 7]);
    expect(searchIssues(ISSUES, "webhook retries", new Set()).map((i) => i.number)).toEqual([120]);
    expect(searchIssues(ISSUES, "webhook", new Set(["I_120"])).map((i) => i.number)).toEqual([12, 7]);
  });

  it("caps the list", () => {
    expect(searchIssues(ISSUES, "", new Set(), 2)).toHaveLength(2);
  });
});

describe("loop guards", () => {
  it("an issue's descendants can't become its parent", () => {
    expect([...selfAndDescendants(ISSUES, "I_1")].sort()).toEqual(["I_1", "I_12", "I_120"]);
    expect([...selfAndDescendants(ISSUES, "I_7")]).toEqual(["I_7"]);
  });

  it("an issue's ancestors can't become its sub-issue", () => {
    const byNodeId = new Map(ISSUES.map((i) => [i.nodeId, i]));
    expect([...selfAndAncestors(byNodeId, "I_120")]).toEqual(["I_120", "I_12", "I_1"]);
  });
});
