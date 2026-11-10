// Task assist, assembled on the server (SPEC §4.9, AI2): the typed quick-add
// line, or the Inbox tasks with no project, plus the user's projects, sections,
// labels and the cached issues whose titles share words with the text. The model
// is asked only here, when the user asks; a suggestion is text until the user
// accepts it, and accepting a task change is a normal local edit with Undo.
import { randomUUID } from "node:crypto";
import { LOCAL_OWNER } from "../local-owner";
import { readAiSettings } from "../settings";
import { getStore } from "../store";
import { compareTasks, type Task } from "../tasks/model";
import { listTasks } from "../tasks/service";
import { inputHash } from "./prompt";
import { latestResultRow, type StoredResult } from "./results";
import { startJob, type Job } from "./runner";
import { aiStatus, type AiStatus } from "./status";
import {
  issuesSharingWords,
  taskAssistTask,
  TASK_ASSIST_FEATURE,
  type TaskAssistCurrent,
  type TaskAssistInput,
  type TaskAssistIssue,
  type TaskAssistProject,
  type TaskAssistSuggestion,
} from "./task-assist";
import type { TaskClock } from "./task-clock";

/** How many Inbox tasks one Tidy Inbox run covers. */
export const MAX_TIDY_TASKS = 200;
/** Characters of a task's description used to find candidate issues. */
const MAX_CANDIDATE_TEXT = 2_000;
/** The clock used only to build a stored result's input hash: the data blocks are not hashed. */
const HASH_CLOCK: TaskClock = { today: "1970-01-01", now: "00:00", tz: "UTC" };

/** A stored suggestion as the page shows it. */
export type TaskSuggestionView = {
  /** The `ai_results` id, null without a database (demo and tests). */
  id: string | null;
  result: TaskAssistSuggestion;
  provider: string;
  model: string;
  createdAt: string;
  acceptedAt: string | null;
  dismissedAt: string | null;
  /** False once the task changed: "Outdated · Run again" (SPEC §4.9). */
  fresh: boolean;
};

/** One Inbox task with its newest suggestion, or null. */
export type TidyInboxTaskView = { taskId: string; title: string; suggestion: TaskSuggestionView | null };
export type TidyInboxView = { tasks: TidyInboxTaskView[]; total: number; ai: AiStatus };

/** What the user can choose from: active projects with their sections, labels and cached issues. */
type Choices = {
  projects: TaskAssistProject[];
  labels: { id: string; name: string }[];
  issues: TaskAssistIssue[];
};

async function choices(): Promise<Choices> {
  const [{ projects, sections, labels }, issues] = await Promise.all([listTasks(LOCAL_OWNER), cachedIssues()]);
  return {
    projects: projects
      .filter((p) => !p.archived)
      .map((p) => ({
        id: p.id,
        name: p.name,
        sections: sections
          .filter((s) => s.projectId === p.id)
          .sort((a, b) => a.position - b.position)
          .map((s) => ({ id: s.id, name: s.name })),
      })),
    labels: labels.map((l) => ({ id: l.id, name: l.name })),
    issues,
  };
}

/** Every cached issue as a candidate; an empty list when the cache isn't readable yet. */
async function cachedIssues(): Promise<TaskAssistIssue[]> {
  try {
    const store = await getStore();
    return [...store.issues.values()].map((i) => ({ number: i.number, title: i.title, state: i.state === "closed" ? ("closed" as const) : ("open" as const) }));
  } catch {
    return [];
  }
}

/** The open tasks filed in the Inbox: no project, no parent, in the default order. */
async function inboxTasks(): Promise<Task[]> {
  const { tasks } = await listTasks(LOCAL_OWNER);
  return tasks.filter((t) => !t.completedAt && t.projectId === null && !t.parentId).sort(compareTasks);
}

/** A typed quick-add line's input: the text and the clock, with the user's choices. */
export async function quickAddInput(text: string, clock: TaskClock): Promise<TaskAssistInput> {
  const { projects, labels, issues } = await choices();
  return {
    mode: "quick-add",
    text,
    description: "",
    today: clock.today,
    now: clock.now,
    tz: clock.tz,
    projects,
    labels,
    issues: issuesSharingWords(issues, text),
    current: null,
    taskId: null,
    subjectVersion: text,
  };
}

/** One Inbox task's input: its current values, the choices and the candidate issues. */
function inboxInput(task: Task, c: Choices, clock: TaskClock): TaskAssistInput {
  const current: TaskAssistCurrent = {
    title: task.title,
    projectId: task.projectId,
    sectionId: task.sectionId,
    labelIds: task.labels,
    priority: task.priority,
    dueDate: task.dueDate,
    dueTime: task.dueTime,
    recurrence: task.recurrence,
    links: task.links.map((l) => l.number),
  };
  return {
    mode: "inbox",
    text: task.title,
    description: task.description,
    today: clock.today,
    now: clock.now,
    tz: clock.tz,
    projects: c.projects,
    labels: c.labels,
    issues: issuesSharingWords(c.issues, `${task.title} ${task.description.slice(0, MAX_CANDIDATE_TEXT)}`),
    current,
    taskId: task.id,
    subjectVersion: task.updatedAt,
  };
}

/** Asks for a suggestion for a typed quick-add line. */
export async function startTaskAssist(text: string, clock: TaskClock): Promise<Job> {
  return startJob(taskAssistTask(await quickAddInput(text, clock)));
}

/**
 * Asks for one suggestion per Inbox task (SPEC §4.9 batch): one job each,
 * sharing a batch id, run one at a time by the runner. `taskIds` reruns only
 * those tasks ("Outdated · Run again"); without it every Inbox task is asked.
 * Nothing starts when a named task is no longer in the Inbox, so a stale list
 * asks nothing.
 */
export async function startTidyInbox(clock: TaskClock, taskIds?: string[]): Promise<{ batchId: string | null; jobs: Job[]; total: number }> {
  const c = await choices();
  const tasks = await inboxTasks();
  const selected = taskIds ? tasks.filter((t) => taskIds.includes(t.id)) : tasks;
  if (taskIds && selected.length !== taskIds.length) return { batchId: null, jobs: [], total: tasks.length };
  const capped = selected.slice(0, MAX_TIDY_TASKS);
  const batchId = randomUUID();
  const jobs = await Promise.all(capped.map((t) => startJob(taskAssistTask(inboxInput(t, c, clock)), { batchId })));
  return { batchId, jobs, total: tasks.length };
}

function suggestionView(row: StoredResult, fresh: boolean): TaskSuggestionView {
  return {
    id: row.id,
    result: row.result as TaskAssistSuggestion,
    provider: row.provider,
    model: row.model,
    createdAt: row.createdAt.toISOString(),
    acceptedAt: row.acceptedAt?.toISOString() ?? null,
    dismissedAt: row.dismissedAt?.toISOString() ?? null,
    fresh,
  };
}

/**
 * The Inbox tasks with their newest suggestion, and whether AI may run. A
 * suggestion that was already accepted is not shown again; rebuilding the input
 * gives the hash, so a changed task (or prompt, schema or extra instructions)
 * marks its suggestion outdated.
 */
export async function tidyInboxView(): Promise<TidyInboxView> {
  const [tasks, c, ai, settings] = await Promise.all([inboxTasks(), choices(), aiStatus(), readAiSettings()]);
  const capped = tasks.slice(0, MAX_TIDY_TASKS);
  const rows = await Promise.all(capped.map((t) => latestResultRow(TASK_ASSIST_FEATURE, t.id)));
  const views = capped.map((task, i) => {
    const row = rows[i];
    if (!row || row.acceptedAt) return { taskId: task.id, title: task.title, suggestion: null };
    const fresh = row.inputHash === inputHash(taskAssistTask(inboxInput(task, c, HASH_CLOCK)), settings.extraInstructions);
    return { taskId: task.id, title: task.title, suggestion: suggestionView(row, fresh) };
  });
  return { tasks: views, total: tasks.length, ai };
}
