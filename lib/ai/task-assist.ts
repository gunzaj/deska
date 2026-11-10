// Task assist suggestions (SPEC §4.9, AI2): the task the model is asked for,
// in the quick-add windows and for "Tidy Inbox". Pure: the server assembles the
// input from the task store and the cache, and the tests build the same task from
// fixtures. The schema is built per request with enums of real project, section,
// label and cached-issue IDs ("Closed choices"), so a value that does not exist
// cannot come back.
import { z } from "zod/v4";
import { isIsoDate } from "../tasks/dates";
import { TITLE_MAX, type PatchTaskInput, type Priority } from "../tasks/model";
import { isValidRule } from "../tasks/recurrence";
import { TASK_ASSIST_INSTRUCTIONS } from "./prompts/task-assist";
import type { AiTask } from "./prompt";
import type { TaskClock } from "./task-clock";

export const TASK_ASSIST_FEATURE = "task-assist";
export const TASK_ASSIST_SUBJECT_KIND = "task";
/** How many cached issues may be offered as a link (SPEC §4.9). */
export const MAX_TASK_ISSUES = 10;
/** Characters of task text sent per task (title plus description). */
export const MAX_TASK_TEXT = 4_000;

/** Where the suggestion comes from: a typed line not saved yet, or one Inbox task. */
export type TaskAssistMode = "quick-add" | "inbox";

/** One of the user's projects, with the sections it has (§4.6). */
export type TaskAssistProject = { id: string; name: string; sections: { id: string; name: string }[] };
/** A cached issue whose title shares words with the task (SPEC §4.9). */
export type TaskAssistIssue = { number: number; title: string; state: "open" | "closed" };

/** The task's current values (inbox mode): what a suggestion may keep or change. */
export type TaskAssistCurrent = {
  title: string;
  projectId: string | null;
  sectionId: string | null;
  /** Label IDs; the input's `labels` maps them to names. */
  labelIds: string[];
  priority: Priority;
  dueDate: string | null;
  dueTime: string | null;
  recurrence: { rule: string; text: string; fromCompletion: boolean } | null;
  /** Linked issue numbers. */
  links: number[];
};

/** Everything a task suggestion is built from. The server reads it from the task store. */
export type TaskAssistInput = {
  mode: TaskAssistMode;
  /** The typed line (quick-add), or the task's title (inbox). */
  text: string;
  /** The task's description (inbox); empty for a typed line. */
  description: string;
  /** Today in the viewer's time zone, YYYY-MM-DD. */
  today: string;
  /** The current time, HH:mm. */
  now: string;
  /** The viewer's time zone. */
  tz: TaskClock["tz"];
  /** The user's active projects with their sections. */
  projects: TaskAssistProject[];
  /** The user's labels. */
  labels: { id: string; name: string }[];
  /** From the cache: issues whose titles share words with the text, best first. */
  issues: TaskAssistIssue[];
  /** The task's current values (inbox mode); null for a typed line. */
  current: TaskAssistCurrent | null;
  /** The task's id (inbox), or null for a typed line. */
  taskId: string | null;
  /** The task's `updated_at` (inbox) or the typed text (quick-add): part of the input hash. */
  subjectVersion: string;
};

/** A suggested repeating schedule, as the task model stores it (§4.6). */
export type TaskAssistRecurrence = { rule: string; text: string; fromCompletion: boolean };

/**
 * What the model answers. A null field means "no value" in quick-add and "keep
 * the current value" in inbox mode; the schema leaves a key out when the user has
 * nothing to choose from (no projects, no labels, no cached issue).
 */
export type TaskAssistSuggestion = {
  title: string | null;
  dueDate: string | null;
  dueTime: string | null;
  recurrence: TaskAssistRecurrence | null;
  priority: number | null;
  reason: string;
  projectId?: string | null;
  sectionId?: string | null;
  labelIds?: string[];
  /** The number of one of the candidate issues, as a string (like AI1's `duplicateOf`). */
  issueNumber?: string | null;
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const RULE = z.string().min(1).max(200).refine(isValidRule, "unsupported recurrence");

/**
 * The answer schema, built per request: enums of the real project, section,
 * label and candidate-issue IDs (SPEC §4.9 "Closed choices"). A part the user
 * has no choices for is left out.
 */
export function taskAssistSchema(input: Pick<TaskAssistInput, "projects" | "labels" | "issues">): z.ZodType<TaskAssistSuggestion> {
  const sections = input.projects.flatMap((p) => p.sections);
  const shape: Record<string, z.ZodType> = {
    title: z.string().min(1).max(TITLE_MAX).nullable(),
    dueDate: z.string().regex(DATE).refine(isIsoDate, "not a calendar date").nullable(),
    dueTime: z.string().regex(TIME).nullable(),
    recurrence: z
      .object({ rule: RULE, text: z.string().trim().min(1).max(100), fromCompletion: z.boolean() })
      .nullable(),
    priority: z.number().int().min(1).max(4).nullable(),
    reason: z.string().min(1).max(300),
  };
  if (input.projects.length) shape.projectId = z.enum(input.projects.map((p) => p.id)).nullable();
  if (sections.length) shape.sectionId = z.enum(sections.map((s) => s.id)).nullable();
  if (input.labels.length) shape.labelIds = z.array(z.enum(input.labels.map((l) => l.id))).max(5);
  shape.issueNumber = input.issues.length ? z.enum(input.issues.map((i) => String(i.number))).nullable() : z.null();
  return z.object(shape) as unknown as z.ZodType<TaskAssistSuggestion>;
}

const trim = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max).trimEnd()}…`);

/** "Name (id)" lines for the projects with their sections. */
function projectsText(projects: TaskAssistProject[]): string {
  if (!projects.length) return "(no projects)";
  return projects
    .map((p) => `${p.name} (${p.id})${p.sections.length ? ` — sections: ${p.sections.map((s) => `${s.name} (${s.id})`).join(", ")}` : ""}`)
    .join("\n");
}

/** The task's current values, in the words the model can compare against (inbox mode). */
function currentText(input: TaskAssistInput): string {
  const c = input.current;
  if (!c) return "(not saved yet)";
  const project = input.projects.find((p) => p.id === c.projectId);
  const section = project?.sections.find((s) => s.id === c.sectionId);
  const labels = c.labelIds.flatMap((id) => input.labels.find((l) => l.id === id)?.name ?? []);
  const due = c.dueDate ? `${c.dueDate}${c.dueTime ? ` ${c.dueTime}` : ""}` : "(no due date)";
  const recurrence = c.recurrence ? `${c.recurrence.text} (${c.recurrence.rule})` : "(none)";
  return [
    `Title: ${c.title}`,
    `Project: ${project ? project.name : "Inbox"}`,
    `Section: ${section ? section.name : "(none)"}`,
    `Labels: ${labels.length ? labels.join(", ") : "(none)"}`,
    `Priority: ${c.priority}`,
    `Due: ${due}`,
    `Repeats: ${recurrence}`,
    `Linked issues: ${c.links.length ? c.links.map((n) => `#${n}`).join(", ") : "(none)"}`,
  ].join("\n");
}

/** The untrusted content, each block separate and labelled (SPEC §4.9 "Untrusted input"). */
function data(input: TaskAssistInput): { label: string; text: string }[] {
  const out: { label: string; text: string }[] = [];
  out.push({ label: "mode", text: input.mode === "inbox" ? "inbox: one saved task to tidy" : "quick-add: one typed line, not saved yet" });
  out.push({ label: "context", text: `Today: ${input.today}\nNow: ${input.now}\nTime zone: ${input.tz}` });
  if (input.mode === "inbox") {
    out.push({ label: "task", text: trim(`${input.text}\n\n${input.description.trim() || "(no description)"}`, MAX_TASK_TEXT) });
    out.push({ label: "current values", text: currentText(input) });
  } else {
    out.push({ label: "typed line", text: trim(input.text, MAX_TASK_TEXT) || "(empty)" });
  }
  out.push({ label: "projects", text: projectsText(input.projects) });
  out.push({ label: "labels", text: input.labels.length ? input.labels.map((l) => `${l.name} (${l.id})`).join(", ") : "(none)" });
  if (input.issues.length) out.push({ label: "candidate issues", text: input.issues.map((i) => `#${i.number} ${i.title} (${i.state})`).join("\n") });
  return out;
}

/** The task: prompt version, data blocks, schema and the subject's version (input hash). */
export function taskAssistTask(input: TaskAssistInput): AiTask {
  return {
    feature: TASK_ASSIST_FEATURE,
    subjectKind: TASK_ASSIST_SUBJECT_KIND,
    subject: subjectOf(input),
    subjectVersion: input.subjectVersion,
    instructions: TASK_ASSIST_INSTRUCTIONS,
    data: data(input),
    schema: taskAssistSchema(input),
    schemaName: "task_assist",
  };
}

/** What an `ai_results` row is about: the task's id (inbox) or the typed line's hash (quick-add). */
export function subjectOf(input: Pick<TaskAssistInput, "mode" | "text" | "taskId">): string {
  if (input.mode === "inbox") return input.taskId ?? `inbox:${hash(input.text)}`;
  return `quick-add:${hash(input.text)}`;
}

/** A short stable hash, so the same typed line is one subject (the full text stays out of the row's key). */
function hash(text: string): string {
  // Not a security hash: only a stable, short key for `ai_results.subject`.
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "with", "from", "at", "by", "as", "is", "are", "be", "it", "this", "that",
  "we", "you", "i", "my", "our", "me", "us", "need", "add", "make", "get", "use", "new", "task", "tasks", "todo",
]);

/** The words a text is matched by: lower-case, unaccented, at least three letters, no stop words. */
export function titleWords(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w));
}

/**
 * The cached issues whose titles share words with the text, best first
 * (SPEC §4.9 "cached issues whose titles share words with the text").
 * Open issues win a tie, then the lower number.
 */
export function issuesSharingWords<T extends TaskAssistIssue>(issues: T[], text: string, limit = MAX_TASK_ISSUES): T[] {
  const wanted = new Set(titleWords(text));
  if (!wanted.size) return [];
  const scored: { issue: T; score: number }[] = [];
  for (const issue of issues) {
    let score = 0;
    for (const w of titleWords(issue.title)) if (wanted.has(w)) score++;
    if (score > 0) scored.push({ issue, score });
  }
  scored.sort((a, b) => b.score - a.score || (a.issue.state === "open" ? -1 : 1) - (b.issue.state === "open" ? -1 : 1) || a.issue.number - b.issue.number);
  return scored.slice(0, limit).map((s) => s.issue);
}

/**
 * Fix what the schema cannot say: a section must belong to the suggested
 * project (or, in inbox mode, to the project the task keeps), a due time and a
 * recurrence need a due date, and a project the user no longer has is dropped.
 */
export function normalizeTaskSuggestion(input: Pick<TaskAssistInput, "projects" | "labels" | "current">, s: TaskAssistSuggestion): TaskAssistSuggestion {
  const projectId = s.projectId && input.projects.some((p) => p.id === s.projectId) ? s.projectId : null;
  const effectiveProject = projectId ?? input.current?.projectId ?? null;
  const sections = input.projects.find((p) => p.id === effectiveProject)?.sections ?? [];
  const sectionId = s.sectionId && sections.some((x) => x.id === s.sectionId) ? s.sectionId : null;
  const dueDate = s.dueDate ?? null;
  const labelIds = (s.labelIds ?? []).filter((id) => input.labels.some((l) => l.id === id));
  return {
    ...s,
    projectId,
    sectionId,
    dueDate,
    dueTime: dueDate ? s.dueTime : null,
    recurrence: dueDate && s.recurrence && isValidRule(s.recurrence.rule) ? s.recurrence : null,
    priority: s.priority != null && s.priority >= 1 && s.priority <= 4 ? s.priority : null,
    labelIds: labelIds.length ? labelIds : undefined,
  };
}

/**
 * The local edit a Tidy Inbox suggestion means, or null when it changes
 * nothing. Accepting it is a normal local edit with Undo (SPEC §4.9); the
 * patch carries only the fields the suggestion names.
 */
export function tidyPatch(input: Pick<TaskAssistInput, "projects" | "labels" | "current">, suggestion: TaskAssistSuggestion): PatchTaskInput | null {
  const current = input.current;
  if (!current) return null;
  const s = normalizeTaskSuggestion(input, suggestion);
  const patch: PatchTaskInput = {};
  if (s.title !== null && s.title !== current.title) patch.title = s.title;
  if (s.dueDate !== null && (s.dueDate !== current.dueDate || s.dueTime !== current.dueTime)) {
    patch.dueDate = s.dueDate;
    patch.dueTime = s.dueTime;
  }
  if (s.recurrence !== null && (!current.recurrence || current.recurrence.rule !== s.recurrence.rule || current.recurrence.fromCompletion !== s.recurrence.fromCompletion)) {
    patch.recurrence = s.recurrence;
  }
  if (s.priority !== null && s.priority !== current.priority) patch.priority = s.priority as Priority;
  if (s.projectId !== null && s.projectId !== current.projectId) {
    patch.projectId = s.projectId;
    patch.sectionId = s.sectionId;
  } else if (s.sectionId !== null && s.sectionId !== current.sectionId) {
    patch.sectionId = s.sectionId;
  }
  const names = (s.labelIds ?? []).flatMap((id) => input.labels.find((l) => l.id === id)?.name ?? []);
  const currentNames = current.labelIds.flatMap((id) => input.labels.find((l) => l.id === id)?.name ?? []);
  const added = names.filter((name) => !currentNames.includes(name));
  if (added.length) patch.labels = [...currentNames, ...added];
  if (s.issueNumber != null && !current.links.includes(Number(s.issueNumber))) patch.links = [...current.links, Number(s.issueNumber)];
  return Object.keys(patch).length ? patch : null;
}
