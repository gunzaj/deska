"use client";

// The triage queues and the hooks over them, apart from the pages that render
// them: the sidebar needs the count on every route, and importing it from the
// page pulled the whole explorer in with it (v5 3.9).
import { useMemo } from "react";
import { runExplorer, type ExplorerState } from "@/lib/client/explorer";
import { OPEN } from "@/lib/client/presets";
import { withTeamScope } from "@/lib/client/team-scope";
import { withoutSnoozed } from "@/lib/client/triage";
import type { Filter } from "@/lib/views/view";
import { useAppData } from "../app/provider";
import { useTeamScope } from "../app/team-scope";
import { useSnoozes } from "./snoozes";

/** Triage queues: each is a locked filter set over open issues. */
export const TRIAGE_TABS: { id: string; label: string; hint: string; base: Filter[]; defaults: ExplorerState }[] = [
  {
    id: "needs",
    label: "Needs triage",
    hint: "Open issues missing a Priority or a Team.",
    base: [OPEN, { field: "any", filters: [{ field: "priority", op: "empty" }, { field: "team", op: "empty" }] }],
    defaults: { filters: [], sort: [{ field: "created", dir: "desc" }], layout: "list" },
  },
  {
    id: "new",
    label: "New this week",
    hint: "Opened in the last 7 days.",
    base: [OPEN, { field: "created", op: "within_days", days: 7 }],
    defaults: { filters: [], sort: [{ field: "created", dir: "desc" }], layout: "list" },
  },
  {
    id: "unplanned",
    label: "Not in a release",
    hint: "Open issues with no Release, highest priority first.",
    base: [OPEN, { field: "release", op: "empty" }],
    defaults: { filters: [], sort: [{ field: "priority", dir: "desc" }, { field: "updated", dir: "desc" }], groupBy: "team", layout: "list" },
  },
  {
    id: "unassigned",
    label: "Unassigned in current release",
    hint: "Planned for the current Release but nobody owns them.",
    base: [OPEN, { field: "release", op: "in", values: ["current"] }, { field: "assignee", op: "empty" }],
    defaults: { filters: [], sort: [{ field: "priority", dir: "desc" }], groupBy: "team", layout: "list" },
  },
  {
    id: "stale",
    label: "Stale",
    hint: "Open and untouched for more than 90 days — close or re-plan.",
    base: [OPEN, { field: "updated", op: "older_than_days", days: 90 }],
    defaults: { filters: [], sort: [{ field: "updated", dir: "asc" }], layout: "list" },
  },
];

/** The queue's issues for this viewer: snoozed ones are out until their date (F3). */
export function useQueueRows(tab: (typeof TRIAGE_TABS)[number]) {
  const { data } = useAppData();
  const { snoozes } = useSnoozes();
  const { teamId } = useTeamScope();
  return useMemo(
    () => withoutSnoozed(runExplorer(data.issues, withTeamScope(tab.base, [], teamId), tab.defaults.sort, data.meta), snoozes, data.meta.today),
    [data, tab, snoozes, teamId],
  );
}

export function useTriageCount(): number {
  const { data } = useAppData();
  const { snoozes } = useSnoozes();
  const { teamId } = useTeamScope();
  return useMemo(() => withoutSnoozed(runExplorer(data.issues, withTeamScope(TRIAGE_TABS[0]!.base, [], teamId), [], data.meta), snoozes, data.meta.today).length, [data, snoozes, teamId]);
}
