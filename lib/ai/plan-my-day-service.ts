// Plan my day, assembled on the server (SPEC §4.9, AI3): the open tasks that are
// overdue, due within 7 days or in the Inbox, and the user's open issues in the
// current sprint, with their triage snoozes. The model is asked only here, when the
// user asks; a plan is text until the user accepts an item. Accepting a new date is
// a normal local task edit with Undo, and "Add to tasks" creates a linked local
// task, so no plan item is ever a GitHub write.
import { LOCAL_OWNER } from "../local-owner";
import { readAiSettings } from "../settings";
import { getStore } from "../store";
import { addDays } from "../tasks/dates";
import { compareTasks } from "../tasks/model";
import { listTasks } from "../tasks/service";
import { listSnoozes } from "../triage/snoozes";
import { resolveRelease } from "../views/rows";
import { inputHash } from "./prompt";
import {
  MAX_PLAN_ISSUES,
  MAX_PLAN_TASKS,
  normalizePlan,
  PLAN_FEATURE,
  PLAN_WINDOW_DAYS,
  planMyDayTask,
  type PlanIssueCandidate,
  type PlanMyDayInput,
  type PlanMyDaySuggestion,
  type PlanTaskCandidate,
} from "./plan-my-day";
import { latestResultRow, type StoredResult } from "./results";
import { startJob, type Job } from "./runner";
import { aiStatus, type AiStatus } from "./status";
import type { TaskClock } from "./task-clock";

/** A stored plan as the page shows it. */
export type PlanView = {
  /** The `ai_results` id, null without a database (demo and tests). */
  id: string | null;
  /** The plan, checked against the candidates it was built from. */
  result: PlanMyDaySuggestion;
  provider: string;
  model: string;
  createdAt: string;
  acceptedAt: string | null;
  dismissedAt: string | null;
  /** False once a candidate changed: "Outdated · Run again" (SPEC §4.9). */
  fresh: boolean;
};

/** Today's plan, what a new one would be built from, and whether AI may run. */
export type PlanMyDayView = {
  /** The stored plan for the day, or null (a dismissed plan is not shown again). */
  plan: PlanView | null;
  /** What a new plan would be built from now. */
  candidates: { tasks: number; issues: number };
  ai: AiStatus;
};

/**
 * Everything a plan is built from (SPEC §4.9, AI3). The tasks are local; the
 * issues are the user's open issues in the current sprint, read from the cache.
 * Only the current sprint's issues are candidates, so the model cannot name
 * another sprint's issue. A snooze travels with its issue, so an issue the user
 * postponed is not planned before that date.
 */
export async function planMyDayInput(viewer: string, clock: TaskClock): Promise<PlanMyDayInput> {
  const store = await getStore();
  const { tasks, projects } = await listTasks(LOCAL_OWNER);
  const projectNames = new Map(projects.map((p) => [p.id, p.name]));
  const soon = addDays(clock.today, PLAN_WINDOW_DAYS);
  const candidates = tasks
    .filter((t) => !t.completedAt)
    .filter((t) => (t.dueDate != null && t.dueDate <= soon) || (t.projectId === null && !t.parentId))
    .sort(compareTasks)
    .slice(0, MAX_PLAN_TASKS)
    .map(
      (t): PlanTaskCandidate => ({
        id: t.id,
        title: t.title,
        dueDate: t.dueDate,
        dueTime: t.dueTime,
        priority: t.priority,
        project: t.projectId ? (projectNames.get(t.projectId) ?? null) : null,
        version: t.updatedAt,
      }),
    );

  const mapping = store.projectFieldMap();
  const sprint = resolveRelease(store, "current", clock.today);
  const snoozes = new Map((await listSnoozes(viewer)).map((s) => [s.nodeId, s.until]));
  const issues: PlanIssueCandidate[] = [];
  if (sprint) {
    const me = viewer.toLowerCase();
    for (const issue of store.issues.values()) {
      if (issue.state !== "open") continue;
      if (!issue.assigneeIds.some((id) => store.ghUsers.get(id)?.login.toLowerCase() === me)) continue;
      const item = store.itemForIssue(issue.nodeId);
      // A remapped Sprint value lives in `dims` by field ID (D4).
      const value = item ? (item.releaseIter ?? (mapping.sprint ? (item.dims?.[mapping.sprint.id] ?? null) : null)) : null;
      if (value !== sprint) continue;
      const milestone = issue.milestoneId ? store.milestones.get(issue.milestoneId) : undefined;
      issues.push({
        number: issue.number,
        title: issue.title,
        state: "open",
        dueOn: milestone?.dueOn ?? null,
        snoozedUntil: snoozes.get(issue.nodeId) ?? null,
        version: issue.updatedAt,
      });
    }
  }
  issues.sort((a, b) => a.number - b.number);

  return { today: clock.today, now: clock.now, tz: clock.tz, tasks: candidates, issues: issues.slice(0, MAX_PLAN_ISSUES) };
}

function planView(row: StoredResult, input: PlanMyDayInput, fresh: boolean): PlanView {
  return {
    id: row.id,
    result: normalizePlan(input, row.result as PlanMyDaySuggestion),
    provider: row.provider,
    model: row.model,
    createdAt: row.createdAt.toISOString(),
    acceptedAt: row.acceptedAt?.toISOString() ?? null,
    dismissedAt: row.dismissedAt?.toISOString() ?? null,
    fresh,
  };
}

/**
 * Today's newest plan and whether AI may run. A dismissed plan is not shown
 * again (SPEC §4.9). Rebuilding the input gives the hash, so a changed
 * candidate marks the stored plan outdated.
 */
export async function latestPlan(viewer: string, clock: TaskClock): Promise<PlanMyDayView> {
  const input = await planMyDayInput(viewer, clock);
  const ai = await aiStatus();
  const candidates = { tasks: input.tasks.length, issues: input.issues.length };
  const row = await latestResultRow(PLAN_FEATURE, clock.today);
  if (!row) return { plan: null, candidates, ai };
  const settings = await readAiSettings();
  const fresh = row.inputHash === inputHash(planMyDayTask(input), settings.extraInstructions);
  return { plan: planView(row, input, fresh), candidates, ai };
}

/** Asks the model for today's plan; null when there is nothing to plan. */
export async function startPlanMyDay(viewer: string, clock: TaskClock): Promise<Job | null> {
  const input = await planMyDayInput(viewer, clock);
  if (!input.tasks.length && !input.issues.length) return null;
  return startJob(planMyDayTask(input));
}
