// Full v1 schema from SPEC §7. Key rule: everything references issues.id
// (internal uuid), never GitHub node IDs or numbers directly.
import { sql } from "drizzle-orm";
import type { ProjectSource, SidebarLayout } from "../lib/tasks/model";
import {
  type AnyPgColumn,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  date,
  doublePrecision,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const ghUsers = pgTable(
  "gh_users",
  {
    githubId: text("github_id").primaryKey(),
    login: text("login").notNull(),
    avatarUrl: text("avatar_url"),
  },
  // A lookup index only, not unique: a GitHub login rename can briefly leave
  // two rows for one lowercased login, and a unique index would need a
  // repoint-and-dedupe of every issue assignee. `userId` picks one
  // deterministically and the nightly metadata upsert keys by githubId.
  (t) => [index("gh_users_login_lower_idx").on(sql`lower(${t.login})`)],
);

export const issueTypes = pgTable("issue_types", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  color: text("color"),
  description: text("description"),
});

export const labels = pgTable(
  "labels",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    color: text("color"),
    description: text("description"),
  },
  // Case-insensitive, like every lookup by name (S7).
  (t) => [uniqueIndex("labels_name_lower_uniq").on(sql`lower(${t.name})`)],
);

export const milestones = pgTable("milestones", {
  id: text("id").primaryKey(),
  number: integer("number").notNull(),
  title: text("title").notNull(),
  state: text("state").notNull().default("open"),
  dueOn: timestamp("due_on"),
});

export const issues = pgTable(
  "issues",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ghNodeId: text("gh_node_id").unique(),
    number: integer("number"),
    origin: text("origin").notNull().default("github"),
    title: text("title").notNull().default(""),
    body: text("body").default(""),
    state: text("state").notNull().default("open"),
    stateReason: text("state_reason"),
    issueTypeId: text("issue_type_id"),
    milestoneId: text("milestone_id"),
    parentIssueId: uuid("parent_issue_id"),
    /** GitHub's `subIssuesSummary` (§4.4). Null until read; total 0 = no children. */
    subTotal: integer("sub_total"),
    subCompleted: integer("sub_completed"),
    subSummaryAt: timestamp("sub_summary_at"),
    authorLogin: text("author_login"),
    url: text("url"),
    createdAt: timestamp("created_at"),
    updatedAt: timestamp("updated_at"),
    closedAt: timestamp("closed_at"),
    syncedAt: timestamp("synced_at"),
    deleted: boolean("deleted").notNull().default(false),
    /** Why `deleted` is set (S6): deleted | transferred | aged-out. */
    deletedReason: text("deleted_reason"),
  },
  (t) => [
    index("issues_state_updated_idx").on(t.state, t.updatedAt),
    index("issues_parent_idx").on(t.parentIssueId),
    // Lookups by number are common (panel, duplicates, links).
    index("issues_number_idx").on(t.number),
    // Possible duplicates (F7): title similarity with pg_trgm's `%` operator.
    index("issues_title_trgm_idx").using("gin", sql`${t.title} gin_trgm_ops`),
  ],
);

export const issueLabels = pgTable(
  "issue_labels",
  {
    issueId: uuid("issue_id")
      .notNull()
      .references(() => issues.id, { onDelete: "cascade" }),
    // No FK on purpose: an incremental poll resolves a brand-new label to its
    // name (the row is only created by the nightly metadata fetch), so a FK
    // would reject a valid poll. The read model drops a link with no label row.
    labelId: text("label_id").notNull(),
  },
  (t) => [primaryKey({ columns: [t.issueId, t.labelId] })],
);

export const issueAssignees = pgTable(
  "issue_assignees",
  {
    issueId: uuid("issue_id")
      .notNull()
      .references(() => issues.id, { onDelete: "cascade" }),
    // No FK for the same reason as issue_labels: an unseen assignee resolves to
    // a login until the next metadata import creates the row.
    ghUserId: text("gh_user_id").notNull(),
  },
  (t) => [primaryKey({ columns: [t.issueId, t.ghUserId] })],
);

export const projectFields = pgTable("project_fields", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  name: text("name").notNull(),
  dataType: text("data_type").notNull(),
  position: integer("position"),
  /** Set when GitHub stops listing the field (deleted): a mapping to it shows "Missing field — remap" (§4.1). */
  missingAt: timestamp("missing_at"),
});

// Options and iterations GitHub stops returning are never deleted (S6): they
// get missing_at, drop out of the read model, and saved views that use them
// show "missing option" (SPEC §4). They come back if GitHub lists them again.
export const fieldOptions = pgTable("field_options", {
  id: text("id").primaryKey(),
  fieldId: text("field_id")
    .notNull()
    .references(() => projectFields.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  color: text("color"),
  position: integer("position"),
  missingAt: timestamp("missing_at"),
});

export const iterations = pgTable("iterations", {
  id: text("id").primaryKey(),
  fieldId: text("field_id")
    .notNull()
    .references(() => projectFields.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  startDate: text("start_date").notNull(),
  durationDays: integer("duration_days").notNull(),
  missingAt: timestamp("missing_at"),
});

export const projectItems = pgTable(
  "project_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ghItemId: text("gh_item_id").unique(),
    issueId: uuid("issue_id")
      .notNull()
      .references(() => issues.id, { onDelete: "cascade" }),
    // The values of the fields mapped to Status, Priority and Sprint (§4.1).
    // Every single-select value, by field ID, is in project_item_dims.
    statusOpt: text("status_opt"),
    priorityOpt: text("priority_opt"),
    releaseIter: text("release_iter"),
    updatedAt: timestamp("updated_at"),
    syncedAt: timestamp("synced_at"),
  },
  (t) => [
    // One item per issue (S7): sync keeps the most recently updated one.
    uniqueIndex("project_items_issue_uniq").on(t.issueId),
    index("project_items_release_idx").on(t.releaseIter),
    index("project_items_priority_idx").on(t.priorityOpt),
  ],
);

/**
 * Single-select and iteration values of a project item, keyed by field ID
 * (§4.1): what dimensions (and a remapped Status, Priority or Sprint) read,
 * whatever the fields are called. `option_id` holds the option or iteration ID.
 */
export const projectItemDims = pgTable(
  "project_item_dims",
  {
    itemId: uuid("item_id")
      .notNull()
      .references(() => projectItems.id, { onDelete: "cascade" }),
    fieldId: text("field_id").notNull(),
    optionId: text("option_id").notNull(),
  },
  (t) => [primaryKey({ columns: [t.itemId, t.fieldId] }), index("project_item_dims_field_idx").on(t.fieldId, t.optionId)],
);

// Project items seen by the in-progress project scan (S4). A scan runs
// page by page across cycles, checkpointed by `project.scanCursor`; pruning
// waits for the last page and uses this list, then clears it.
export const projectScanSeen = pgTable(
  "project_scan_seen",
  {
    scanId: text("scan_id").notNull(),
    ghItemId: text("gh_item_id").notNull(),
  },
  (t) => [primaryKey({ columns: [t.scanId, t.ghItemId] })],
);

export const views = pgTable(
  "views",
  {
    // Text, not uuid: seed views have stable readable IDs ("seed-untriaged") so
    // reseeding is idempotent and links to them survive a reseed.
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    definitionJson: jsonb("definition_json").notNull(),
    position: integer("position").notNull().default(0),
    updatedAt: timestamp("updated_at").defaultNow(),
    /** Soft delete, so a deleted view can be restored (U1); purged after 30 days (S8). */
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [index("views_deleted_idx").on(t.deletedAt)],
);

export const outbox = pgTable(
  "outbox",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id"),
    issueId: uuid("issue_id"),
    /** GitHub node ID of the issue (W1): the cache's uuid changes on a rebuild. */
    issueNodeId: text("issue_node_id"),
    op: text("op").notNull().default("update"),
    field: text("field"),
    idempotencyKey: text("idempotency_key"),
    baseJson: jsonb("base_json"),
    newJson: jsonb("new_json"),
    /** GitHub's value when the edit hit a conflict, for the conflict dialog (W2). */
    remoteJson: jsonb("remote_json"),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    error: text("error"),
    /** Retry backoff (W1): a pending row is not picked up before this. */
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    /**
     * Fencing token (v5 1.5): set by whoever claims the row, matched when the
     * result is recorded. A run that outlived its lease finds the token
     * replaced and its result is dropped instead of overwriting the new run's.
     */
    leaseToken: uuid("lease_token"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    // SPEC §5: the outbox is idempotent; the key is per user action.
    uniqueIndex("outbox_idempotency_key_uniq").on(t.idempotencyKey),
    index("outbox_status_idx").on(t.status, t.createdAt),
    // Drain filters on status+next_attempt_at; listOpenEdits filters user+status.
    index("outbox_status_next_idx").on(t.status, t.nextAttemptAt),
    index("outbox_user_status_idx").on(t.userId, t.status),
  ],
);

/**
 * Local, non-secret settings (SPEC §2.4): the GitHub target (repo, org,
 * project number and pinned node ID) and the field mapping. Never the token.
 */
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const syncState = pgTable("sync_state", {
  key: text("key").primaryKey(),
  value: text("value"),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id"),
    issueId: uuid("issue_id"),
    issueNodeId: text("issue_node_id"),
    field: text("field"),
    old: jsonb("old"),
    new: jsonb("new"),
    result: text("result"),
    at: timestamp("at").defaultNow(),
  },
  // Retention deletes by `at`: without this every nightly run scans the table.
  (t) => [index("audit_log_at_idx").on(t.at)],
);

// Tasks (SPEC §12): Deska-native personal to-dos, never written to GitHub.
// Everything local is keyed by LOCAL_OWNER (lib/local-owner.ts), not by a GitHub
// login: the *_login / owner_login columns are kept, and always hold it.
export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    creatorLogin: text("creator_login").notNull(),
    parentId: uuid("parent_id").references((): AnyPgColumn => tasks.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    priority: smallint("priority").notNull().default(4),
    dueDate: date("due_date", { mode: "string" }),
    dueTime: text("due_time"), // HH:mm in due_tz; null = all-day
    dueTz: text("due_tz"),
    recurrenceRule: text("recurrence_rule"),
    recurrenceText: text("recurrence_text"),
    recurrenceFromCompletion: boolean("recurrence_from_completion").notNull().default(false),
    // The section of its project the task sits in (D13); the service keeps it
    // in the task's own project. Deleting a section leaves its tasks unsectioned.
    sectionId: uuid("section_id").references((): AnyPgColumn => taskSections.id, { onDelete: "set null" }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    completedBy: text("completed_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("tasks_creator_idx").on(t.creatorLogin, t.completedAt),
    index("tasks_due_idx").on(t.dueDate),
    index("tasks_parent_idx").on(t.parentId),
    // Retention hard-deletes by deleted_at; visibility filters deleted_at IS NULL.
    index("tasks_deleted_idx").on(t.deletedAt),
    // Priority is 1-4 (P1 Urgent … P4 Low, SPEC §12.1).
    check("tasks_priority_check", sql`${t.priority} between 1 and 4`),
  ],
);

// A task's links to GitHub issues (SPEC §12.1). Keyed by GitHub node ID,
// like the read model: internal issues.id rows are recreated by a cache rebuild,
// node IDs are not. The number is kept so a link still reads "#1234" when the
// item has left the cache.
export const taskLinks = pgTable(
  "task_links",
  {
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    targetKind: text("target_kind").notNull(), // issue (pull request links went in D6)
    targetNodeId: text("target_node_id").notNull(),
    targetNumber: integer("target_number").notNull(),
    position: integer("position").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.taskId, t.targetNodeId] }), index("task_links_target_idx").on(t.targetNodeId)],
);

// Personal task projects (SPEC §12.3). Each user's Inbox is virtual: a task
// with no placement for that user is in their Inbox.
export const taskProjects = pgTable(
  "task_projects",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerLogin: text("owner_login").notNull(),
    name: text("name").notNull(),
    color: text("color").notNull().default("grey"),
    position: doublePrecision("position").notNull().default(0),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    /** GitHub filters the project pulls in (§12.3); null = tasks only. */
    source: jsonb("source").$type<ProjectSource>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("task_projects_owner_idx").on(t.ownerLogin),
    // One project name per owner, case-insensitive: the service checks this, a
    // direct SQL writer must not be able to create a duplicate.
    uniqueIndex("task_projects_owner_name_uniq").on(t.ownerLogin, sql`lower(${t.name})`),
  ],
);

// Sections of a project (D13, SPEC §4.6): named groups tasks are filed under.
export const taskSections = pgTable(
  "task_sections",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerLogin: text("owner_login").notNull(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => taskProjects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    position: doublePrecision("position").notNull().default(0),
    collapsed: boolean("collapsed").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("task_sections_project_idx").on(t.projectId, t.position)],
);

// Where a task is filed: one placement per task (project and manual order).
export const taskPlacements = pgTable(
  "task_placements",
  {
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    login: text("login").notNull(),
    projectId: uuid("project_id").references(() => taskProjects.id, { onDelete: "cascade" }),
    position: doublePrecision("position").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.taskId, t.login] }), index("task_placements_project_idx").on(t.projectId), index("task_placements_login_idx").on(t.login, t.projectId)],
);

// Personal labels (SPEC §12.3, Q4): each user sees only their own on a task.
export const taskLabels = pgTable(
  "task_labels",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerLogin: text("owner_login").notNull(),
    name: text("name").notNull(),
    color: text("color").notNull().default("grey"),
  },
  (t) => [uniqueIndex("task_labels_owner_name_uniq").on(t.ownerLogin, sql`lower(${t.name})`)],
);

export const taskLabelLinks = pgTable(
  "task_label_links",
  {
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    labelId: uuid("label_id")
      .notNull()
      .references(() => taskLabels.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.taskId, t.labelId] }), index("task_label_links_label_idx").on(t.labelId)],
);

// One row per completed occurrence of a recurring task (SPEC §12.5).
export const taskCompletions = pgTable(
  "task_completions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    // Nullable with SET NULL, not cascade: SPEC §12.1 keeps completions as
    // history, so hard-deleting a task (retention) must not erase it.
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
    login: text("login").notNull(),
    dueDate: date("due_date", { mode: "string" }),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  // One row per occurrence (S9): a double-click or a second tab can't log the
  // same occurrence twice and move the due date twice.
  (t) => [uniqueIndex("task_completions_task_due_uniq").on(t.taskId, t.dueDate)],
);

// Extra reminders (SPEC §12.6). The reminder at a timed task's due time is
// implicit and has no row.
export const taskReminders = pgTable(
  "task_reminders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // relative | absolute
    offsetMin: integer("offset_min"), // relative: minutes before the due time
    at: timestamp("at", { withTimezone: true }), // absolute
  },
  // task_id for cascade/listing; (kind, at) for the reminder-firing scan.
  // Uniqueness per (task, kind, offset/at) so a direct writer can't create
  // duplicate reminders (S: the service dedupes, the DB must too). Partial
  // because a relative reminder has no `at` and an absolute one no offset.
  (t) => [
    index("task_reminders_task_idx").on(t.taskId),
    index("task_reminders_kind_at_idx").on(t.kind, t.at),
    uniqueIndex("task_reminders_relative_uniq")
      .on(t.taskId, t.kind, t.offsetMin)
      .where(sql`${t.offsetMin} is not null`),
    uniqueIndex("task_reminders_absolute_uniq")
      .on(t.taskId, t.kind, t.at)
      .where(sql`${t.at} is not null`),
  ],
);

// In-app notifications (SPEC §12.6). dedupe_key makes firing idempotent.
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    login: text("login").notNull(),
    kind: text("kind").notNull(), // reminder | watch_digest
    /** Null for a watchlist digest (F6), which is about no one task. */
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    readAt: timestamp("read_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("notifications_dedupe_uniq").on(t.dedupeKey), index("notifications_login_idx").on(t.login, t.readAt, t.createdAt)],
);

// Per-user settings, keyed by login like tasks (works without a users row).
export const userPrefs = pgTable("user_prefs", {
  login: text("login").primaryKey(),
  tz: text("tz"),
  browserNotifications: boolean("browser_notifications").notNull().default(false),
  /** Section order and hidden sections; null = default sidebar. */
  sidebar: jsonb("sidebar").$type<SidebarLayout>(),
  /** A dimension option ID every list and Insights filter by by default ("My default", §4.1); null = no default. */
  defaultTeam: text("default_team"),
});

// Comments on a task (SPEC §12.7). Deska-only; visibility follows the task.
export const taskComments = pgTable(
  "task_comments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    authorLogin: text("author_login").notNull(),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [index("task_comments_task_idx").on(t.taskId, t.createdAt), index("task_comments_deleted_idx").on(t.deletedAt)],
);

/**
 * Field change history (IMPROVEMENTS F0): what a project field or issue state
 * was, and became, when sync (or Deska's own write) observed it. The cache only
 * keeps the current value; scope-creep (F2) and "what changed" (F6) need this.
 * Values are option/iteration IDs, the state string, or a sorted JSON array of
 * label / assignee IDs. A new issue and the initial import write nothing.
 */
export const issueFieldChanges = pgTable(
  "issue_field_changes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    issueId: uuid("issue_id").notNull().references(() => issues.id, { onDelete: "cascade" }),
    field: text("field").notNull(),
    oldValue: text("old_value"),
    newValue: text("new_value"),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull().defaultNow(),
    /** sync | deska */
    source: text("source").notNull().default("sync"),
  },
  (t) => [index("issue_field_changes_issue_idx").on(t.issueId, t.observedAt), index("issue_field_changes_field_idx").on(t.field, t.observedAt), index("issue_field_changes_observed_idx").on(t.observedAt)],
);

/**
 * Triage snoozes (IMPROVEMENTS F3): an issue a person parked until a date. It
 * leaves that person's triage queues until then and never goes to GitHub.
 * Keyed by node ID, like task links (no foreign key on purpose, SPEC §12.9).
 */
export const triageSnoozes = pgTable(
  "triage_snoozes",
  {
    login: text("login").notNull(),
    issueNodeId: text("issue_node_id").notNull(),
    /** First day the issue is back in the queues (YYYY-MM-DD). */
    until: date("until", { mode: "string" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.login, t.issueNodeId] }), index("triage_snoozes_until_idx").on(t.until)],
);

/**
 * Watchlist (IMPROVEMENTS F6): issues and saved views a person follows, with
 * when they last looked. Keyed by node ID / view ID, no foreign keys (like task
 * links, SPEC §12.9): a watched item that disappears just shows nothing.
 */
export const watches = pgTable(
  "watches",
  {
    login: text("login").notNull(),
    /** issue | view */
    kind: text("kind").notNull(),
    targetId: text("target_id").notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.login, t.kind, t.targetId] })],
);
