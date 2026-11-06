"use client";

// The triage queues and the hooks over them, apart from the pages that render
// them: the sidebar needs the count on every route, and importing it from the
// page pulled the whole explorer in with it (v5 3.9).
import { useMemo } from "react";
import { primaryDimension, runExplorer, sprintOn, type ExplorerState } from "@/lib/client/explorer";
import { OPEN } from "@/lib/client/presets";
import { withDefaultScope } from "@/lib/client/team-scope";
import type { ClientMeta } from "@/lib/client/types";
import { withoutSnoozed } from "@/lib/client/triage";
import type { Filter } from "@/lib/views/view";
import { useAppData } from "../app/provider";
import { useDefaultScope } from "../app/team-scope";
import { useSnoozes } from "./snoozes";

export type TriageTab = { id: string; label: string; hint: string; base: Filter[]; defaults: ExplorerState };

/**
 * Triage queues: each is a locked filter set over open issues. "Needs triage"
 * means no Priority, or no value in the first mapped dimension (e.g. a team
 * field, §4.1); the Sprint queues need a Sprint field.
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

/** The queue's issues for this viewer: snoozed ones are out until their date (F3). */
export function useQueueRows(tab: TriageTab) {
  const { data } = useAppData();
  const { snoozes } = useSnoozes();
  const { scope } = useDefaultScope();
  return useMemo(
    () => withoutSnoozed(runExplorer(data.issues, withDefaultScope(tab.base, [], scope), tab.defaults.sort, data.meta), snoozes, data.meta.today),
    [data, tab, snoozes, scope],
  );
}

export function useTriageCount(): number {
  const { data } = useAppData();
  const { snoozes } = useSnoozes();
  const { scope } = useDefaultScope();
  return useMemo(() => withoutSnoozed(runExplorer(data.issues, withDefaultScope(triageTabs(data.meta)[0]!.base, [], scope), [], data.meta), snoozes, data.meta.today).length, [data, snoozes, scope]);
}
