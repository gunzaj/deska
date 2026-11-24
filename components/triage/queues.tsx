"use client";

// The hooks over the triage queues, apart from the pages that render them: the
// sidebar needs the count on every route, and importing it from the page
// pulled the whole explorer in with it (v5 3.9). The queue definitions are
// pure (lib/client/triage-queues.ts), so Home counts the same way.
import { useMemo } from "react";
import { queueRows, triageTabs, type TriageTab } from "@/lib/client/triage-queues";
import { useAppData } from "../app/provider";
import { useDefaultScope } from "../app/team-scope";
import { useSnoozes } from "./snoozes";

export { triageTabs, type TriageTab };

/** The queue's issues for this viewer: snoozed ones are out until their date (F3). */
export function useQueueRows(tab: TriageTab) {
  const { data } = useAppData();
  const { snoozes } = useSnoozes();
  const { scope } = useDefaultScope();
  return useMemo(() => queueRows(tab, data, snoozes, scope, tab.defaults.sort), [data, tab, snoozes, scope]);
}

export function useTriageCount(): number {
  const { data } = useAppData();
  const { snoozes } = useSnoozes();
  const { scope } = useDefaultScope();
  return useMemo(() => queueRows(triageTabs(data.meta)[0]!, data, snoozes, scope).length, [data, snoozes, scope]);
}
