// The triage queues (IMPROVEMENTS F3): each is a locked filter set over open
// issues. Pure, so the Triage page, the sidebar count and Home all read the
// same definitions.
import { primaryDimension, runExplorer, sprintOn, type ExplorerState } from "./explorer";
import { OPEN } from "./presets";
import { withDefaultScope, type DefaultScope } from "./team-scope";
import { withoutSnoozed } from "./triage";
import type { ClientData, ClientIssue, ClientMeta } from "./types";
import type { Filter, View } from "../views/view";

export type TriageTab = { id: string; label: string; hint: string; base: Filter[]; defaults: ExplorerState };

/**
 * "Needs triage" means no Priority, or no value in the first mapped dimension
 * (e.g. a team field, §4.1); the Sprint queues need a Sprint field.
 */
export function triageTabs(meta: Pick<ClientMeta, "dimensions" | "mapping">): TriageTab[] {
  const dim = primaryDimension(meta);
  const groupBy = dim?.key;
  const sprints = sprintOn(meta);
  return [
    {
      id: "needs",
      label: "Needs triage",
      hint: dim ? `Open issues missing a Priority or a ${dim.name}.` : "Open issues missing a Priority.",
      base: [OPEN, dim ? { field: "any", filters: [{ field: "priority", op: "empty" }, { field: dim.key, op: "empty" }] } : { field: "priority", op: "empty" }],
      defaults: { filters: [], sort: [{ field: "created", dir: "desc" }], layout: "list" },
    },
    {
      id: "new",
      label: "New this week",
      hint: "Opened in the last 7 days.",
      base: [OPEN, { field: "created", op: "within_days", days: 7 }],
      defaults: { filters: [], sort: [{ field: "created", dir: "desc" }], layout: "list" },
    },
    ...(sprints
      ? [
          {
            id: "unplanned",
            label: "Not in a release",
            hint: "Open issues with no Release, highest priority first.",
            base: [OPEN, { field: "release", op: "empty" }] as Filter[],
            defaults: { filters: [], sort: [{ field: "priority", dir: "desc" }, { field: "updated", dir: "desc" }], ...(groupBy ? { groupBy } : {}), layout: "list" } as ExplorerState,
          },
          {
            id: "unassigned",
            label: "Unassigned in current release",
            hint: "Planned for the current Release but nobody owns them.",
            base: [OPEN, { field: "release", op: "in", values: ["current"] }, { field: "assignee", op: "empty" }] as Filter[],
            defaults: { filters: [], sort: [{ field: "priority", dir: "desc" }], ...(groupBy ? { groupBy } : {}), layout: "list" } as ExplorerState,
          },
        ]
      : []),
    {
      id: "stale",
      label: "Stale",
      hint: "Open and untouched for more than 90 days — close or re-plan.",
      base: [OPEN, { field: "updated", op: "older_than_days", days: 90 }],
      defaults: { filters: [], sort: [{ field: "updated", dir: "asc" }], layout: "list" },
    },
  ];
}

/** A queue's issues for this viewer: the default scope applies, snoozed ones are out until their date. */
export function queueRows(
  tab: Pick<TriageTab, "base">,
  data: ClientData,
  snoozes: ReadonlyMap<string, string>,
  scope: Pick<DefaultScope, "dimension" | "optionId"> | null,
  sort: View["sort"] = [],
): ClientIssue[] {
  return withoutSnoozed(runExplorer(data.issues, withDefaultScope(tab.base, [], scope), sort, data.meta), snoozes, data.meta.today);
}
