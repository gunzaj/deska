-- Possible duplicates need pg_trgm (issues_title_trgm_idx below). drizzle-kit
-- does not emit extensions, so it is created here, before any table.
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text,
	"issue_id" uuid,
	"issue_node_id" text,
	"field" text,
	"old" jsonb,
	"new" jsonb,
	"result" text,
	"at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "field_options" (
	"id" text PRIMARY KEY NOT NULL,
	"field_id" text NOT NULL,
	"name" text NOT NULL,
	"color" text,
	"position" integer,
	"missing_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "gh_team_members" (
	"team_slug" text NOT NULL,
	"login" text NOT NULL,
	CONSTRAINT "gh_team_members_team_slug_login_pk" PRIMARY KEY("team_slug","login")
);
--> statement-breakpoint
CREATE TABLE "gh_users" (
	"github_id" text PRIMARY KEY NOT NULL,
	"login" text NOT NULL,
	"avatar_url" text
);
--> statement-breakpoint
CREATE TABLE "issue_assignees" (
	"issue_id" uuid NOT NULL,
	"gh_user_id" text NOT NULL,
	CONSTRAINT "issue_assignees_issue_id_gh_user_id_pk" PRIMARY KEY("issue_id","gh_user_id")
);
--> statement-breakpoint
CREATE TABLE "issue_field_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"issue_id" uuid NOT NULL,
	"field" text NOT NULL,
	"old_value" text,
	"new_value" text,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" text DEFAULT 'sync' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "issue_labels" (
	"issue_id" uuid NOT NULL,
	"label_id" text NOT NULL,
	CONSTRAINT "issue_labels_issue_id_label_id_pk" PRIMARY KEY("issue_id","label_id")
);
--> statement-breakpoint
CREATE TABLE "issue_types" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"color" text,
	"description" text
);
--> statement-breakpoint
CREATE TABLE "issues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gh_node_id" text,
	"number" integer,
	"origin" text DEFAULT 'github' NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"body" text DEFAULT '',
	"state" text DEFAULT 'open' NOT NULL,
	"state_reason" text,
	"issue_type_id" text,
	"milestone_id" text,
	"parent_issue_id" uuid,
	"author_login" text,
	"url" text,
	"created_at" timestamp,
	"updated_at" timestamp,
	"closed_at" timestamp,
	"synced_at" timestamp,
	"deleted" boolean DEFAULT false NOT NULL,
	"deleted_reason" text,
	CONSTRAINT "issues_gh_node_id_unique" UNIQUE("gh_node_id")
);
--> statement-breakpoint
CREATE TABLE "iterations" (
	"id" text PRIMARY KEY NOT NULL,
	"field_id" text NOT NULL,
	"title" text NOT NULL,
	"start_date" text NOT NULL,
	"duration_days" integer NOT NULL,
	"missing_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "labels" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"color" text,
	"description" text
);
--> statement-breakpoint
CREATE TABLE "milestones" (
	"id" text PRIMARY KEY NOT NULL,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"state" text DEFAULT 'open' NOT NULL,
	"due_on" timestamp
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"login" text NOT NULL,
	"kind" text NOT NULL,
	"task_id" uuid,
	"actor_login" text,
	"title" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text,
	"issue_id" uuid,
	"issue_node_id" text,
	"op" text DEFAULT 'update' NOT NULL,
	"field" text,
	"idempotency_key" text,
	"base_json" jsonb,
	"new_json" jsonb,
	"remote_json" jsonb,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"next_attempt_at" timestamp with time zone,
	"lease_token" uuid,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "pr_assignees" (
	"pr_id" uuid NOT NULL,
	"gh_user_id" text NOT NULL,
	CONSTRAINT "pr_assignees_pr_id_gh_user_id_pk" PRIMARY KEY("pr_id","gh_user_id")
);
--> statement-breakpoint
CREATE TABLE "pr_issue_links" (
	"pr_id" uuid NOT NULL,
	"issue_node_id" text NOT NULL,
	CONSTRAINT "pr_issue_links_pr_id_issue_node_id_pk" PRIMARY KEY("pr_id","issue_node_id")
);
--> statement-breakpoint
CREATE TABLE "pr_labels" (
	"pr_id" uuid NOT NULL,
	"label_id" text NOT NULL,
	CONSTRAINT "pr_labels_pr_id_label_id_pk" PRIMARY KEY("pr_id","label_id")
);
--> statement-breakpoint
CREATE TABLE "pr_review_requests" (
	"pr_id" uuid NOT NULL,
	"reviewer_kind" text NOT NULL,
	"reviewer" text NOT NULL,
	CONSTRAINT "pr_review_requests_pr_id_reviewer_kind_reviewer_pk" PRIMARY KEY("pr_id","reviewer_kind","reviewer")
);
--> statement-breakpoint
CREATE TABLE "pr_reviews" (
	"pr_id" uuid NOT NULL,
	"author_login" text NOT NULL,
	"state" text NOT NULL,
	"submitted_at" timestamp with time zone,
	CONSTRAINT "pr_reviews_pr_id_author_login_pk" PRIMARY KEY("pr_id","author_login")
);
--> statement-breakpoint
CREATE TABLE "project_fields" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"data_type" text NOT NULL,
	"position" integer
);
--> statement-breakpoint
CREATE TABLE "project_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gh_item_id" text,
	"issue_id" uuid NOT NULL,
	"status_opt" text,
	"priority_opt" text,
	"team_opt" text,
	"platform_opt" text,
	"release_iter" text,
	"updated_at" timestamp,
	"synced_at" timestamp,
	CONSTRAINT "project_items_gh_item_id_unique" UNIQUE("gh_item_id")
);
--> statement-breakpoint
CREATE TABLE "project_scan_seen" (
	"scan_id" text NOT NULL,
	"gh_item_id" text NOT NULL,
	CONSTRAINT "project_scan_seen_scan_id_gh_item_id_pk" PRIMARY KEY("scan_id","gh_item_id")
);
--> statement-breakpoint
CREATE TABLE "pull_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gh_node_id" text NOT NULL,
	"number" integer NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"body" text,
	"state" text NOT NULL,
	"is_draft" boolean DEFAULT false NOT NULL,
	"author_login" text NOT NULL,
	"url" text NOT NULL,
	"head_ref" text DEFAULT '' NOT NULL,
	"base_ref" text DEFAULT '' NOT NULL,
	"review_decision" text,
	"checks_state" text,
	"milestone_id" text,
	"additions" integer DEFAULT 0 NOT NULL,
	"deletions" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	"merged_at" timestamp with time zone,
	"fingerprint" text NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted" boolean DEFAULT false NOT NULL,
	"deleted_reason" text,
	CONSTRAINT "pull_requests_gh_node_id_unique" UNIQUE("gh_node_id")
);
--> statement-breakpoint
CREATE TABLE "sync_state" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "task_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"author_login" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "task_completions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid,
	"login" text NOT NULL,
	"due_date" date,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_label_links" (
	"task_id" uuid NOT NULL,
	"label_id" uuid NOT NULL,
	CONSTRAINT "task_label_links_task_id_label_id_pk" PRIMARY KEY("task_id","label_id")
);
--> statement-breakpoint
CREATE TABLE "task_labels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_login" text NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT 'grey' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_links" (
	"task_id" uuid NOT NULL,
	"target_kind" text NOT NULL,
	"target_node_id" text NOT NULL,
	"target_number" integer NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "task_links_task_id_target_node_id_pk" PRIMARY KEY("task_id","target_node_id")
);
--> statement-breakpoint
CREATE TABLE "task_placements" (
	"task_id" uuid NOT NULL,
	"login" text NOT NULL,
	"project_id" uuid,
	"position" double precision DEFAULT 0 NOT NULL,
	CONSTRAINT "task_placements_task_id_login_pk" PRIMARY KEY("task_id","login")
);
--> statement-breakpoint
CREATE TABLE "task_projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_login" text NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT 'grey' NOT NULL,
	"position" double precision DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"source" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"offset_min" integer,
	"at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_login" text NOT NULL,
	"assignee_login" text,
	"parent_id" uuid,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"priority" smallint DEFAULT 4 NOT NULL,
	"due_date" date,
	"due_time" text,
	"due_tz" text,
	"recurrence_rule" text,
	"recurrence_text" text,
	"recurrence_from_completion" boolean DEFAULT false NOT NULL,
	"completed_at" timestamp with time zone,
	"completed_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "tasks_priority_check" CHECK ("tasks"."priority" between 1 and 4)
);
--> statement-breakpoint
CREATE TABLE "triage_snoozes" (
	"login" text NOT NULL,
	"issue_node_id" text NOT NULL,
	"until" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "triage_snoozes_login_issue_node_id_pk" PRIMARY KEY("login","issue_node_id")
);
--> statement-breakpoint
CREATE TABLE "user_prefs" (
	"login" text PRIMARY KEY NOT NULL,
	"tz" text,
	"browser_notifications" boolean DEFAULT false NOT NULL,
	"sidebar" jsonb,
	"default_team" text
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"github_id" text NOT NULL,
	"login" text NOT NULL,
	"name" text,
	"avatar_url" text,
	"token_enc" text,
	CONSTRAINT "users_github_id_unique" UNIQUE("github_id")
);
--> statement-breakpoint
CREATE TABLE "views" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"name" text NOT NULL,
	"visibility" text DEFAULT 'personal' NOT NULL,
	"definition_json" jsonb NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now(),
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "watches" (
	"login" text NOT NULL,
	"kind" text NOT NULL,
	"target_id" text NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "watches_login_kind_target_id_pk" PRIMARY KEY("login","kind","target_id")
);
--> statement-breakpoint
ALTER TABLE "field_options" ADD CONSTRAINT "field_options_field_id_project_fields_id_fk" FOREIGN KEY ("field_id") REFERENCES "public"."project_fields"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_assignees" ADD CONSTRAINT "issue_assignees_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_field_changes" ADD CONSTRAINT "issue_field_changes_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_labels" ADD CONSTRAINT "issue_labels_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iterations" ADD CONSTRAINT "iterations_field_id_project_fields_id_fk" FOREIGN KEY ("field_id") REFERENCES "public"."project_fields"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pr_assignees" ADD CONSTRAINT "pr_assignees_pr_id_pull_requests_id_fk" FOREIGN KEY ("pr_id") REFERENCES "public"."pull_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pr_issue_links" ADD CONSTRAINT "pr_issue_links_pr_id_pull_requests_id_fk" FOREIGN KEY ("pr_id") REFERENCES "public"."pull_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pr_labels" ADD CONSTRAINT "pr_labels_pr_id_pull_requests_id_fk" FOREIGN KEY ("pr_id") REFERENCES "public"."pull_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pr_review_requests" ADD CONSTRAINT "pr_review_requests_pr_id_pull_requests_id_fk" FOREIGN KEY ("pr_id") REFERENCES "public"."pull_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pr_reviews" ADD CONSTRAINT "pr_reviews_pr_id_pull_requests_id_fk" FOREIGN KEY ("pr_id") REFERENCES "public"."pull_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_items" ADD CONSTRAINT "project_items_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_completions" ADD CONSTRAINT "task_completions_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_label_links" ADD CONSTRAINT "task_label_links_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_label_links" ADD CONSTRAINT "task_label_links_label_id_task_labels_id_fk" FOREIGN KEY ("label_id") REFERENCES "public"."task_labels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_links" ADD CONSTRAINT "task_links_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_placements" ADD CONSTRAINT "task_placements_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_placements" ADD CONSTRAINT "task_placements_project_id_task_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."task_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_reminders" ADD CONSTRAINT "task_reminders_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_parent_id_tasks_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_at_idx" ON "audit_log" USING btree ("at");--> statement-breakpoint
CREATE INDEX "gh_users_login_lower_idx" ON "gh_users" USING btree (lower("login"));--> statement-breakpoint
CREATE INDEX "issue_field_changes_issue_idx" ON "issue_field_changes" USING btree ("issue_id","observed_at");--> statement-breakpoint
CREATE INDEX "issue_field_changes_field_idx" ON "issue_field_changes" USING btree ("field","observed_at");--> statement-breakpoint
CREATE INDEX "issue_field_changes_observed_idx" ON "issue_field_changes" USING btree ("observed_at");--> statement-breakpoint
CREATE INDEX "issues_state_updated_idx" ON "issues" USING btree ("state","updated_at");--> statement-breakpoint
CREATE INDEX "issues_parent_idx" ON "issues" USING btree ("parent_issue_id");--> statement-breakpoint
CREATE INDEX "issues_number_idx" ON "issues" USING btree ("number");--> statement-breakpoint
CREATE INDEX "issues_title_trgm_idx" ON "issues" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "labels_name_lower_uniq" ON "labels" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_dedupe_uniq" ON "notifications" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "notifications_login_idx" ON "notifications" USING btree ("login","read_at","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "outbox_idempotency_key_uniq" ON "outbox" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "outbox_status_idx" ON "outbox" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "outbox_status_next_idx" ON "outbox" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "outbox_user_status_idx" ON "outbox" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "pr_issue_links_issue_idx" ON "pr_issue_links" USING btree ("issue_node_id");--> statement-breakpoint
CREATE INDEX "pr_review_requests_reviewer_idx" ON "pr_review_requests" USING btree ("reviewer");--> statement-breakpoint
CREATE UNIQUE INDEX "project_items_issue_uniq" ON "project_items" USING btree ("issue_id");--> statement-breakpoint
CREATE INDEX "project_items_release_idx" ON "project_items" USING btree ("release_iter");--> statement-breakpoint
CREATE INDEX "project_items_team_idx" ON "project_items" USING btree ("team_opt");--> statement-breakpoint
CREATE INDEX "project_items_priority_idx" ON "project_items" USING btree ("priority_opt");--> statement-breakpoint
CREATE INDEX "pull_requests_state_updated_idx" ON "pull_requests" USING btree ("state","updated_at");--> statement-breakpoint
CREATE INDEX "pull_requests_number_idx" ON "pull_requests" USING btree ("number");--> statement-breakpoint
CREATE INDEX "task_comments_task_idx" ON "task_comments" USING btree ("task_id","created_at");--> statement-breakpoint
CREATE INDEX "task_comments_deleted_idx" ON "task_comments" USING btree ("deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "task_completions_task_due_uniq" ON "task_completions" USING btree ("task_id","due_date");--> statement-breakpoint
CREATE INDEX "task_label_links_label_idx" ON "task_label_links" USING btree ("label_id");--> statement-breakpoint
CREATE UNIQUE INDEX "task_labels_owner_name_uniq" ON "task_labels" USING btree ("owner_login",lower("name"));--> statement-breakpoint
CREATE INDEX "task_links_target_idx" ON "task_links" USING btree ("target_node_id");--> statement-breakpoint
CREATE INDEX "task_placements_project_idx" ON "task_placements" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "task_placements_login_idx" ON "task_placements" USING btree ("login","project_id");--> statement-breakpoint
CREATE INDEX "task_projects_owner_idx" ON "task_projects" USING btree ("owner_login");--> statement-breakpoint
CREATE UNIQUE INDEX "task_projects_owner_name_uniq" ON "task_projects" USING btree ("owner_login",lower("name"));--> statement-breakpoint
CREATE INDEX "task_reminders_task_idx" ON "task_reminders" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "task_reminders_kind_at_idx" ON "task_reminders" USING btree ("kind","at");--> statement-breakpoint
CREATE UNIQUE INDEX "task_reminders_relative_uniq" ON "task_reminders" USING btree ("task_id","kind","offset_min") WHERE "task_reminders"."offset_min" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "task_reminders_absolute_uniq" ON "task_reminders" USING btree ("task_id","kind","at") WHERE "task_reminders"."at" is not null;--> statement-breakpoint
CREATE INDEX "tasks_assignee_idx" ON "tasks" USING btree ("assignee_login","completed_at");--> statement-breakpoint
CREATE INDEX "tasks_creator_idx" ON "tasks" USING btree ("creator_login","completed_at");--> statement-breakpoint
CREATE INDEX "tasks_due_idx" ON "tasks" USING btree ("due_date");--> statement-breakpoint
CREATE INDEX "tasks_parent_idx" ON "tasks" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "tasks_deleted_idx" ON "tasks" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "triage_snoozes_until_idx" ON "triage_snoozes" USING btree ("until");--> statement-breakpoint
CREATE INDEX "views_owner_idx" ON "views" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "views_deleted_idx" ON "views" USING btree ("deleted_at");