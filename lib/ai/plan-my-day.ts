// Plan my day suggestions (SPEC §4.9, AI3): the task the model is asked for.
// Pure: the server assembles the input from the task store and the issue cache,
// and the tests build the same task from fixtures. The schema is built per request
// with enums of real task IDs and issue numbers ("Closed choices"), so a value
// that does not exist cannot come back. Nothing here changes anything: a plan is
// text until the user accepts an item.
import { z } from "zod/v4";
import { isIsoDate } from "../tasks/dates";
import type { Priority } from "../tasks/model";
import { PLAN_MY_DAY_INSTRUCTIONS } from "./prompts/plan-my-day";
import type { AiTask } from "./prompt";
import type { TaskClock } from "./task-clock";

export const PLAN_FEATURE = "plan-my-day";
export const PLAN_SUBJECT_KIND = "day";
/** How many open tasks one plan is built from (overdue, due within 7 days, Inbox). */
export const MAX_PLAN_TASKS = 60;
/** How many of the user's open issues in the current sprint one plan is built from. */
export const MAX_PLAN_ISSUES = 20;
/** How many items the plan itself may list. */
export const MAX_PLAN_ITEMS = 25;
/** "Due within 7 days" means today through today + 7. */
export const PLAN_WINDOW_DAYS = 7;

/** One open task the plan may name. */
export type PlanTaskCandidate = {
  id: string;
  title: string;
  /** YYYY-MM-DD, or null for a task with no date. */
  dueDate: string | null;
  dueTime: string | null;
  priority: Priority;
  /** The task's project name; null for an Inbox task. */
  project: string | null;
  /** The task's `updated_at`: part of the input hash, never sent. */
  version: string;
};

/** One open issue assigned to the user in the current sprint the plan may name. */
export type PlanIssueCandidate = {
  number: number;
  title: string;
  state: "open" | "closed";
  /** The milestone's due date, when the issue has a milestone with one. */
  dueOn: string | null;
  /** A triage snooze: the issue must not be planned before this date. */
  snoozedUntil: string | null;
  /** The issue's `updated_at`: part of the input hash, never sent. */
  version: string;
};

/** Everything a plan is built from. The server reads it from the task store and the cache. */
export type PlanMyDayInput = {
  /** Today in the viewer's time zone, YYYY-MM-DD. */
  today: string;
  /** The current time, HH:mm. */
  now: string;
  /** The viewer's time zone. */
  tz: TaskClock["tz"];
  /** Open tasks that are overdue, due within 7 days, or in the Inbox. */
  tasks: PlanTaskCandidate[];
  /** Open issues assigned to the viewer in the current sprint. */
  issues: PlanIssueCandidate[];
};

/** One item of the plan: a candidate task or issue, in the order to do them. */
export type PlanItem = {
  kind: "task" | "issue";
  /** The candidate's task id (kind "task") or issue number as a string (kind "issue"). */
  id: string;
  /** One short sentence on why it belongs in today's plan. */
  reason: string;
  /** A new date for an overdue task (YYYY-MM-DD); null keeps the task's date. */
  dueDate: string | null;
  /** A time on that date (HH:mm); null for an all-day task. */
  dueTime: string | null;
};

/** What the model answers. */
export type PlanMyDaySuggestion = {
  /** One short sentence on the shape of the day. */
  summary: string;
  /** Ordered for today, most important first. */
  items: PlanItem[];
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * The answer schema, built per request: enums of the real candidate task IDs and
 * issue numbers (SPEC §4.9 "Closed choices"). The service never asks with no
 * candidates, so the enum always has a value.
 */
export function planMyDaySchema(input: Pick<PlanMyDayInput, "tasks" | "issues">): z.ZodType<PlanMyDaySuggestion> {
  const ids = [...input.tasks.map((t) => t.id), ...input.issues.map((i) => String(i.number))];
  const id = ids.length ? z.enum(ids) : z.string().max(0);
  return z.object({
    summary: z.string().min(1).max(500),
    items: z
      .array(
        z.object({
          kind: z.enum(["task", "issue"]),
          id,
          reason: z.string().min(1).max(300),
          dueDate: z
            .string()
            .regex(DATE)
            .refine(isIsoDate, "not a calendar date")
            .nullable(),
          dueTime: z.string().regex(TIME).nullable(),
        }),
      )
      .max(MAX_PLAN_ITEMS),
  }) as unknown as z.ZodType<PlanMyDaySuggestion>;
}

const trim = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max).trimEnd()}…`);

/** The task's line in the tasks block: its id, title, due date, priority and project. */
function taskLine(t: PlanTaskCandidate): string {
  const due = t.dueDate ? `${t.dueDate}${t.dueTime ? ` ${t.dueTime}` : ""}` : "no date";
  return `[${t.id}] ${t.title} — due ${due}, priority P${t.priority}, ${t.project ? `project ${t.project}` : "Inbox"}`;
}

/** The issue's line in the issues block: its number, title, state, milestone due date and snooze. */
function issueLine(i: PlanIssueCandidate): string {
  const parts = [`#${i.number} ${i.title} (${i.state})`];
  if (i.dueOn) parts.push(`milestone due ${i.dueOn}`);
  if (i.snoozedUntil) parts.push(`snoozed until ${i.snoozedUntil}`);
  return parts.join(" — ");
}

/** The untrusted content, each block separate and labelled (SPEC §4.9 "Untrusted input"). */
function data(input: PlanMyDayInput): { label: string; text: string }[] {
  return [
    { label: "context", text: `Today: ${input.today}\nNow: ${input.now}\nTime zone: ${input.tz}` },
    { label: "tasks", text: input.tasks.length ? input.tasks.map(taskLine).join("\n") : "(no tasks)" },
    { label: "issues", text: input.issues.length ? input.issues.map(issueLine).join("\n") : "(no issues)" },
  ];
}

/**
 * What changes about the day: every candidate's version and the date. A task or
 * issue edited, or a candidate appearing or leaving, changes the input hash, so a
 * stored plan shows "Outdated · Run again" (SPEC §4.9).
 */
export function planVersion(input: Pick<PlanMyDayInput, "today" | "tasks" | "issues">): string {
  const tasks = input.tasks.map((t) => [t.id, t.version, t.title, t.dueDate, t.dueTime, t.priority, t.project]);
  const issues = input.issues.map((i) => [i.number, i.version, i.title, i.state, i.dueOn, i.snoozedUntil]);
  return `${input.today}#${JSON.stringify([tasks, issues])}`;
}

/** The task: prompt version, data blocks, schema and the day's version (input hash). */
export function planMyDayTask(input: PlanMyDayInput): AiTask {
  return {
    feature: PLAN_FEATURE,
    subjectKind: PLAN_SUBJECT_KIND,
    subject: input.today,
    subjectVersion: planVersion(input),
    instructions: PLAN_MY_DAY_INSTRUCTIONS,
    data: data(input),
    schema: planMyDaySchema(input),
    schemaName: "plan_my_day",
  };
}

/** A task is overdue when its date is before today. */
export function isOverdue(t: Pick<PlanTaskCandidate, "dueDate">, today: string): boolean {
  return t.dueDate != null && t.dueDate < today;
}

/**
 * The new date the plan gives an overdue task, or null. Only an overdue task gets
 * a new date (SPEC §4.9 "new dates for overdue tasks"), the date must be a real
 * day that is today or later, and a time needs that date.
 */
export function planNewDate(t: Pick<PlanTaskCandidate, "dueDate">, item: PlanItem, today: string): { dueDate: string; dueTime: string | null } | null {
  if (!isOverdue(t, today) || !item.dueDate || !isIsoDate(item.dueDate) || item.dueDate < today) return null;
  return { dueDate: item.dueDate, dueTime: item.dueTime && TIME.test(item.dueTime) ? item.dueTime : null };
}

/**
 * The plan's items checked against the candidates: only existing tasks and issues
 * survive, a duplicated item is kept once, a date suggestion only applies to an
 * overdue task, and an issue is not planned before its snooze date. Nothing partial
 * becomes a suggestion; a dropped item changes nothing.
 */
export function normalizePlan(input: Pick<PlanMyDayInput, "today" | "tasks" | "issues">, suggestion: PlanMyDaySuggestion): PlanMyDaySuggestion {
  const tasks = new Map(input.tasks.map((t) => [t.id, t]));
  const issues = new Map(input.issues.map((i) => [String(i.number), i]));
  const seen = new Set<string>();
  const items: PlanItem[] = [];
  for (const raw of suggestion.items) {
    const key = `${raw.kind}:${raw.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const reason = trim(raw.reason.trim(), 300);
    if (!reason) continue;
    if (raw.kind === "task") {
      const t = tasks.get(raw.id);
      if (!t) continue;
      const next = planNewDate(t, raw, input.today);
      items.push({ kind: "task", id: t.id, reason, dueDate: next?.dueDate ?? null, dueTime: next?.dueTime ?? null });
    } else {
      const i = issues.get(raw.id);
      if (!i) continue;
      // A snoozed issue waits: it is planned on or after its snooze date, not before.
      if (i.snoozedUntil && i.snoozedUntil > input.today) continue;
      items.push({ kind: "issue", id: String(i.number), reason, dueDate: null, dueTime: null });
    }
  }
  return { summary: trim(suggestion.summary.trim(), 500) || "Plan for today.", items: items.slice(0, MAX_PLAN_ITEMS) };
}
