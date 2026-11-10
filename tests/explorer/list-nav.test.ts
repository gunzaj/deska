import { describe, expect, it } from "vitest";
import type { Group } from "@/lib/client/explorer";
import {
  boardNavRows,
  collapsedGroups,
  focusForIssue,
  listNavRows,
  rangeNodeIds,
  shownNodeIds,
  stepFocus,
  toggleGroup,
  visibleSelection,
} from "@/lib/client/list-nav";
import type { ClientIssue } from "@/lib/client/types";

const issue = (n: number) => ({ nodeId: `I_${n}`, number: n }) as unknown as ClientIssue;
const [i1, i2, i3, i4] = [issue(1), issue(2), issue(3), issue(4)];
// Grouped by label: #2 carries both "bug" and "ui".
const byLabel: Group[] = [
  { key: "bug", label: "bug", field: "label", rows: [i1!, i2!] },
  { key: "ui", label: "ui", field: "label", rows: [i2!, i3!] },
];

describe("j/k over a list where an issue shows in several groups", () => {
  it("moves by position, through every place an issue shows", () => {
    const rows = listNavRows(byLabel, new Set());
    let key: string | null = null;
    const seen: number[] = [];
    for (let k = 0; k < 4; k++) {
      key = stepFocus(rows, key, 1)!.key;
      seen.push(rows.find((r) => r.key === key)!.issue.number);
    }
    expect(seen).toEqual([1, 2, 2, 3]);
    // And back up again, not stuck on #2's first place.
    key = stepFocus(rows, key, -1)!.key;
    key = stepFocus(rows, key, -1)!.key;
    expect(rows.findIndex((r) => r.key === key)).toBe(1);
  });
  it("Shift+click ranges by position", () => {
    const rows = listNavRows(byLabel, new Set());
    // From #2 under "ui" down to #3: not from #2's first place under "bug".
    expect(rangeNodeIds(rows, rows[2]!.key, rows[3]!.key)).toEqual(["I_2", "I_3"]);
    expect(rangeNodeIds(rows, rows[0]!.key, rows[3]!.key)).toEqual(["I_1", "I_2", "I_3"]);
  });
  it("the side panel keeps the focused place when it shows the same issue", () => {
    const rows = listNavRows(byLabel, new Set());
    expect(focusForIssue(rows, rows[2]!.key, 2)).toBe(rows[2]!.key);
    expect(focusForIssue(rows, rows[0]!.key, 2)).toBe(rows[1]!.key);
  });
  it("board cards are places too", () => {
    const rows = boardNavRows([{ key: "alice", rows: [i2!] }, { key: "bob", rows: [i2!, i3!] }], 50);
    expect(new Set(rows.map((r) => r.key)).size).toBe(3);
    expect(stepFocus(rows, rows[0]!.key, 1)!.key).toBe(rows[1]!.key);
  });
});

describe("collapsed groups", () => {
  const sprint: Group[] = [
    { key: "remaining", label: "Remaining", field: "sprintState", rows: [i1!] },
    { key: "done", label: "Done", field: "sprintState", rows: [i2!] },
    { key: "not_planned", label: "Not planned", field: "sprintState", rows: [i3!, i4!], collapsed: true },
  ];
  it("keeps hidden rows out of j/k and ⌘A", () => {
    const rows = listNavRows(sprint, collapsedGroups(sprint, {}));
    expect(shownNodeIds(rows)).toEqual(["I_1", "I_2"]);
    expect(stepFocus(rows, rows[1]!.key, 1)!.issue.number).toBe(2);
  });
  it("collapses a default-collapsed group also when the grouping switches to it after load", () => {
    // The user toggled something under another grouping first.
    let toggled = toggleGroup({}, byLabel[0]!, collapsedGroups(byLabel, {}));
    expect(collapsedGroups(byLabel, toggled).has("label:bug")).toBe(true);
    expect([...collapsedGroups(sprint, toggled)]).toEqual(["sprintState:not_planned"]);
    // Expanding it is remembered.
    toggled = toggleGroup(toggled, sprint[2]!, collapsedGroups(sprint, toggled));
    expect(collapsedGroups(sprint, toggled).size).toBe(0);
  });
});

describe("bulk selection", () => {
  it("acts only on selected rows still shown, once per issue", () => {
    const all = listNavRows(byLabel, new Set());
    const selected = new Set(["I_2", "I_4"]); // #4 was selected, then a filter hid it
    expect(visibleSelection(all, selected).map((i) => i.number)).toEqual([2]);
    // A collapsed group hides its rows from the edit too.
    const ui = listNavRows(byLabel, new Set(["label:bug"]));
    expect(visibleSelection(ui, new Set(["I_1", "I_3"])).map((i) => i.number)).toEqual([3]);
  });
});
