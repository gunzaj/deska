// Task model shared by server and browser (SPEC §12). Framework-free and
// server-import-free. Rules that decide who sees or changes a task live here so
// the API, the repos and the tests all use the same definitions.
import { z } from "zod";
import { isIsoDate, isTimeZone } from "./dates";
import { isValidRule } from "./recurrence";
import { filterSchema, type Filter } from "../views/view";

/** Deska's own scale (§12.1): P1 Urgent … P4 Low. Independent of project Priority. */
export type Priority = 1 | 2 | 3 | 4;

export const PRIORITIES: { value: Priority; label: string; short: string }[] = [
  { value: 1, label: "Urgent", short: "P1" },
  { value: 2, label: "High", short: "P2" },
  { value: 3, label: "Medium", short: "P3" },
  { value: 4, label: "Low", short: "P4" },
];

/** Extra reminder (§12.6): minutes before the due time, or an absolute instant. */
export type Reminder = { id: string; kind: "relative"; offsetMin: number } | { id: string; kind: "absolute"; at: string };

export type Recurrence = { rule: string; text: string; fromCompletion: boolean };

/** A link to a GitHub issue, by node ID plus number (§12.1). */
export type TaskLink = { kind: "issue"; nodeId: string; number: number };

/** A task's own fields. */
export type TaskCore = {
  id: string;
  /** Always LOCAL_OWNER: every task belongs to this install (§4.6). */
  creator: string;
  /** Sub-task of (one level only, §12.1). */
  parentId: string | null;
  /** The section of its project it sits in (§4.6, D13); null = none. Top-level tasks only. */
  sectionId: string | null;
  title: string;
  description: string;
  priority: Priority;
  dueDate: string | null; // YYYY-MM-DD
  dueTime: string | null; // HH:mm; null = all-day
  dueTz: string | null; // IANA zone the due time is in
  recurrence: Recurrence | null;
  reminders: Reminder[];
  completedAt: string | null;
  completedBy: string | null;
  links: TaskLink[];
  createdAt: string;
  updatedAt: string;
};

/** A task plus where it is filed and its labels (§12.3). */
export type Task = TaskCore & {
  projectId: string | null; // null = Inbox
  position: number;
  labels: string[]; // label IDs
};

/**
 * GitHub issues a project pulls in (§12.3): those matching `issues`, shown
 * live from the cache next to the project's tasks. Uses the explorer's own
 * filter model.
 */
export type ProjectSource = { issues: Filter[] | null };

export type TaskProject = { id: string; name: string; color: string; position: number; archived: boolean; source: ProjectSource | null };
export type TaskLabel = { id: string; name: string; color: string };
/** A named group inside a project (D13). Order is `position`; `collapsed` is remembered. */
export type TaskSection = { id: string; projectId: string; name: string; position: number; collapsed: boolean };

/**
 * One line of the Completed view (D13): a task completed in the window, or one
 * occurrence of a recurring task (which stays open). `undoable` is false for an
 * occurrence that a later one has replaced.
 */
export type CompletedItem = { key: string; task: Task; at: string; occurrence: string | null; undoable: boolean };
/** A ⌘K task hit and where the words were found (D13). */
export type SearchHit = { task: Task; in: "title" | "description" | "comment" };
/** The Completed view shows this many days back. */
export const COMPLETED_DAYS = 30;

/** Colours for projects and labels; names map to theme-safe swatches in the UI. */
export const TASK_COLORS = ["grey", "red", "orange", "yellow", "green", "teal", "blue", "violet", "pink"] as const;

export const TITLE_MAX = 500;
export const LINKS_MAX = 20;
export const LABELS_MAX = 20;
export const NAME_MAX = 60;
export const DESCRIPTION_MAX = 20_000;

export function normLogin(login: string): string {
  return login.trim().toLowerCase();
}

/**
 * Default order (§9 T1): overdue first, then due date, then priority, then
 * created. Overdue sorts first on its own because it has the earliest dates;
 * tasks without a due date go last.
 */
export function compareTasks(a: Task, b: Task): number {
  if (a.dueDate !== b.dueDate) {
    if (a.dueDate == null) return 1;
    if (b.dueDate == null) return -1;
    return a.dueDate < b.dueDate ? -1 : 1;
  }
  // Same day: timed tasks first, by time.
  if (a.dueTime !== b.dueTime) {
    if (a.dueTime == null) return 1;
    if (b.dueTime == null) return -1;
    return a.dueTime < b.dueTime ? -1 : 1;
  }
  if (a.priority !== b.priority) return a.priority - b.priority;
  return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
}

/** Completed tasks: most recently completed first. */
export function compareCompleted(a: Task, b: Task): number {
  return (b.completedAt ?? "").localeCompare(a.completedAt ?? "");
}

// --- Input validation (API) ---------------------------------------------

const isoDate = z.string().refine(isIsoDate, "expected a calendar date as YYYY-MM-DD");

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "expected HH:mm");
const tz = z.string().max(64).refine(isTimeZone, "unknown time zone");
const recurrence = z.object({
  rule: z.string().max(200).refine(isValidRule, "unsupported recurrence"),
  text: z.string().trim().min(1).max(100),
  fromCompletion: z.boolean().default(false),
});
const reminderInput = z.union([
  z.object({ kind: z.literal("relative"), offsetMin: z.number().int().min(0).max(60 * 24 * 14) }),
  z.object({ kind: z.literal("absolute"), at: z.string().datetime() }),
]);
const reminders = z.array(reminderInput).max(10);
export type ReminderInput = z.infer<typeof reminderInput>;

const priority = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]);

const uuid = z.string().uuid();
const name = z.string().trim().min(1, "name required").max(NAME_MAX);
const labelNames = z.array(name).max(LABELS_MAX);

// Issue numbers to link; resolved against the cache by the server.
const linkNumbers = z.array(z.number().int().positive()).max(LINKS_MAX);

export const createTaskSchema = z
  .object({
    // May be empty when the task links an item: it then takes that item's title (§12.1).
    title: z.string().trim().max(TITLE_MAX).default(""),
    description: z.string().max(DESCRIPTION_MAX).default(""),
    priority: priority.default(4),
    dueDate: isoDate.nullable().default(null),
    dueTime: hhmm.nullable().default(null),
    /** The creator's time zone, for a due time. */
    tz: tz.optional(),
    recurrence: recurrence.nullable().default(null),
    reminders: reminders.default([]),
    links: linkNumbers.default([]),
    parentId: uuid.nullable().default(null),
    /** The creator's project; null = Inbox. */
    projectId: uuid.nullable().default(null),
    /** A section of that project; null = none. */
    sectionId: uuid.nullable().default(null),
    /** Label names; unknown ones are created for the viewer (§12.4 `+label`). */
    labels: labelNames.default([]),
  })
  .refine((t) => t.title.length > 0 || t.links.length > 0, { message: "title required", path: ["title"] })
  .refine((t) => !t.dueTime || t.dueDate, { message: "a due time needs a due date", path: ["dueTime"] })
  .refine((t) => !t.recurrence || t.dueDate, { message: "a recurring task needs a due date", path: ["recurrence"] });
export type CreateTaskInput = z.infer<typeof createTaskSchema>;

export const patchTaskSchema = z
  .object({
    title: z.string().trim().min(1, "title required").max(TITLE_MAX),
    description: z.string().max(DESCRIPTION_MAX),
    priority,
    dueDate: isoDate.nullable(),
    dueTime: hhmm.nullable(),
    tz,
    recurrence: recurrence.nullable(),
    /** The full new set of extra reminders. */
    reminders,
    completed: z.boolean(),
    /** With `completed: true` on a recurring task: stop recurring and complete it for good. */
    endRecurrence: z.boolean(),
    /** The full new set of linked numbers. */
    links: linkNumbers,
    /** Viewer's own filing: project (null = Inbox) and manual order. */
    projectId: uuid.nullable(),
    position: z.number().finite(),
    /** A section of the task's project (null = none). Moving to another project clears it unless given. */
    sectionId: uuid.nullable(),
    /** The viewer's full new label set, by name. */
    labels: labelNames,
    /** With `completed: true`, also complete open sub-tasks. */
    cascade: z.boolean(),
    /**
     * The task's `updatedAt` the client last saw (S9). When it no longer
     * matches, a change to shared fields is refused with 409 and the current
     * task. Filing changes (project, position, labels) are never refused.
     */
    expectedUpdatedAt: z.string().max(40),
    /**
     * Undo completing a recurring task's occurrence (U1): its completion row
     * goes and the due date moves back to it.
     */
    undoOccurrence: isoDate,
  })
  .partial()
  .strict();
export type PatchTaskInput = z.infer<typeof patchTaskSchema>;

const color = z.enum(TASK_COLORS);

export const projectInputSchema = z.object({ name, color: color.default("grey") });
export const projectSourceSchema = z
  .object({ issues: z.array(filterSchema).max(30).nullable() })
  .strict()
  // No issue filter is the same as no source.
  .transform((s): ProjectSource | null => (s.issues ? s : null));
export const projectPatchSchema = z
  .object({ name, color, position: z.number().finite(), archived: z.boolean(), source: projectSourceSchema.nullable() })
  .partial()
  .strict();
export const sectionInputSchema = z.object({ projectId: uuid, name });
export const sectionPatchSchema = z.object({ name, position: z.number().finite(), collapsed: z.boolean() }).partial().strict();
export const labelInputSchema = z.object({ name, color: color.default("grey") });
export const labelPatchSchema = z.object({ name, color }).partial().strict();

/** Sidebar sections a user can reorder or hide, in their default order. */
export const SIDEBAR_SECTIONS = ["tasks", "projects", "labels", "workspace", "views", "teams"] as const;
export type SidebarSection = (typeof SIDEBAR_SECTIONS)[number];
export type SidebarLayout = { order: SidebarSection[]; hidden: SidebarSection[] };
const sidebarSection = z.enum(SIDEBAR_SECTIONS);
const sidebarSchema = z.object({ order: z.array(sidebarSection).max(SIDEBAR_SECTIONS.length * 2), hidden: z.array(sidebarSection).max(SIDEBAR_SECTIONS.length * 2) }).strict();

/** Saved layout → every section once, saved order first; sections added later keep their default slot at the end. */
export function resolveSidebar(layout: SidebarLayout | null | undefined): { id: SidebarSection; hidden: boolean }[] {
  const hidden = new Set(layout?.hidden ?? []);
  const order = [...new Set([...(layout?.order ?? []), ...SIDEBAR_SECTIONS])].filter((id): id is SidebarSection => (SIDEBAR_SECTIONS as readonly string[]).includes(id));
  return order.map((id) => ({ id, hidden: hidden.has(id) }));
}

export const prefsSchema = z.object({ tz: tz.nullable(), browserNotifications: z.boolean(), sidebar: sidebarSchema.nullable(), defaultTeam: z.string().min(1).max(100).nullable() }).partial().strict();
export type Prefs = { tz: string | null; browserNotifications: boolean; sidebar: SidebarLayout | null; defaultTeam: string | null };

/** Only reminders and the watchlist digest make notifications (§4.6). */
export type NotificationKind = "reminder" | "watch_digest";
export type AppNotification = {
  id: string;
  kind: NotificationKind;
  /** The task it is about; null for the daily watchlist digest (F6). */
  taskId: string | null;
  title: string;
  createdAt: string;
  readAt: string | null;
};

export const COMMENT_MAX = 10_000;
export type TaskComment = { id: string; taskId: string; author: string; body: string; createdAt: string; updatedAt: string };
export const commentSchema = z.object({ body: z.string().trim().min(1, "comment is empty").max(COMMENT_MAX) }).strict();
