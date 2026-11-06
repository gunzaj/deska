// List shortcuts, defined once (IMPROVEMENTS U3). The explorer and the task
// lists look their keys up here, and the ? dialog is built from the same
// action IDs, so a key that is handled can't be missing from the help.
export type IssueListAction = "next" | "prev" | "open" | "github" | "task" | "select" | "assign" | "priority" | "release" | "search" | "filter";
export type TaskListAction = "next" | "prev" | "open" | "complete" | "move-up" | "move-down";

/** `KeyboardEvent.key` → action, for the issue lists (no modifiers). */
export const ISSUE_LIST_KEYS: Record<string, IssueListAction> = {
  j: "next",
  ArrowDown: "next",
  k: "prev",
  ArrowUp: "prev",
  Enter: "open",
  o: "github",
  t: "task",
  x: "select",
  a: "assign",
  p: "priority",
  r: "release",
  "/": "search",
  f: "filter",
};

export const TASK_LIST_KEYS: Record<string, TaskListAction> = {
  j: "next",
  ArrowDown: "next",
  k: "prev",
  ArrowUp: "prev",
  Enter: "open",
  e: "complete",
};

export type HelpEntry<A extends string> = { action: A; keys: string[]; label: string };

export const ISSUE_LIST_HELP: HelpEntry<IssueListAction>[] = [
  { action: "next", keys: ["J"], label: "Next issue" },
  { action: "prev", keys: ["K"], label: "Previous issue" },
  { action: "open", keys: ["↵"], label: "Open issue" },
  { action: "github", keys: ["O"], label: "Open issue in GitHub" },
  { action: "task", keys: ["T"], label: "Add focused issue to tasks" },
  { action: "select", keys: ["X"], label: "Select the focused issue (bulk edit)" },
  { action: "assign", keys: ["A"], label: "Assign the focused issue" },
  { action: "priority", keys: ["P"], label: "Set priority of the focused issue" },
  { action: "release", keys: ["R"], label: "Set release of the focused issue" },
  { action: "search", keys: ["/"], label: "Search in this list" },
  { action: "filter", keys: ["F"], label: "Add a filter" },
];

export const TASK_LIST_HELP: HelpEntry<TaskListAction>[] = [
  { action: "next", keys: ["J"], label: "Next task" },
  { action: "prev", keys: ["K"], label: "Previous task" },
  { action: "open", keys: ["↵"], label: "Open task" },
  { action: "complete", keys: ["E"], label: "Complete task (a repeating task moves to its next date)" },
  { action: "move-up", keys: ["Alt", "↑"], label: "Move task up" },
  { action: "move-down", keys: ["Alt", "↓"], label: "Move task down" },
];
