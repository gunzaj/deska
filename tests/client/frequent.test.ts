import { describe, expect, it } from "vitest";
import { inOrder, rankChoices } from "@/lib/client/frequent";

type Item = { id: string; checked?: boolean };
const ids = (items: Item[]) => items.map((i) => i.id);
const labels: Item[] = [{ id: "bug" }, { id: "dashboard" }, { id: "design needed" }, { id: "ui", checked: true }, { id: "docs" }];

describe("a picker's order (SPEC §4.8)", () => {
  it("the issue's values, then the frequent choices most used first, then the rest as it came", () => {
    const ranked = rankChoices(labels, ["design needed", "docs"], (i) => i.id, (i) => !!i.checked);
    expect(ids(ranked)).toEqual(["ui", "design needed", "docs", "bug", "dashboard"]);
  });

  it("a frequent choice already on the issue stays with the issue's values", () => {
    const ranked = rankChoices(labels, ["ui", "docs"], (i) => i.id, (i) => !!i.checked);
    expect(ids(ranked)).toEqual(["ui", "docs", "bug", "dashboard", "design needed"]);
  });

  it("nothing frequent keeps the order as it came, and a frequent choice that no longer exists is ignored", () => {
    expect(ids(rankChoices(labels, [], (i) => i.id))).toEqual(ids(labels));
    expect(ids(rankChoices(labels, ["gone"], (i) => i.id))).toEqual(ids(labels));
  });

  it("assignees match by lower-cased login", () => {
    const users = [{ id: "alice" }, { id: "Bob" }, { id: "carol" }];
    expect(ids(rankChoices(users, ["bob"], (u) => u.id.toLowerCase()))).toEqual(["Bob", "alice", "carol"]);
  });

  it("an open picker keeps the order it opened with; a choice that appeared since goes last", () => {
    const opened = ["ui", "design needed", "bug"];
    const now: Item[] = [{ id: "new" }, { id: "bug", checked: true }, { id: "design needed" }, { id: "ui" }];
    expect(ids(inOrder(now, opened))).toEqual(["ui", "design needed", "bug", "new"]);
  });
});
