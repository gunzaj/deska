-- D7: every local record belongs to this install, not to a GitHub account.
-- All owner / login keys become 'local' (lib/local-owner.ts), so tasks, views,
-- snoozes, watches and settings stay visible when another account connects.
-- Rows that would collide once the owners merge are renamed or collapsed first.
DELETE FROM "notifications" WHERE "kind" NOT IN ('reminder', 'watch_digest');--> statement-breakpoint
UPDATE "views" SET "definition_json" = "definition_json" - 'ownerId' - 'visibility';--> statement-breakpoint
WITH ranked AS (SELECT "id", row_number() OVER (PARTITION BY lower("name") ORDER BY "position", "id") AS rn FROM "task_projects")
UPDATE "task_projects" p SET "name" = left(p."name", 40) || ' (' || left(p."id"::text, 8) || ')' FROM ranked r WHERE r."id" = p."id" AND r.rn > 1;--> statement-breakpoint
WITH ranked AS (SELECT "id", row_number() OVER (PARTITION BY lower("name") ORDER BY "id") AS rn FROM "task_labels")
UPDATE "task_labels" l SET "name" = left(l."name", 40) || ' (' || left(l."id"::text, 8) || ')' FROM ranked r WHERE r."id" = l."id" AND r.rn > 1;--> statement-breakpoint
DELETE FROM "task_placements" p USING (
  SELECT tp."task_id", tp."login", row_number() OVER (PARTITION BY tp."task_id" ORDER BY (tp."login" = t."creator_login") DESC, tp."login") AS rn
  FROM "task_placements" tp JOIN "tasks" t ON t."id" = tp."task_id"
) x WHERE p."task_id" = x."task_id" AND p."login" = x."login" AND x.rn > 1;--> statement-breakpoint
DELETE FROM "triage_snoozes" s USING (
  SELECT "login", "issue_node_id", row_number() OVER (PARTITION BY "issue_node_id" ORDER BY "until" DESC, "login") AS rn FROM "triage_snoozes"
) x WHERE s."login" = x."login" AND s."issue_node_id" = x."issue_node_id" AND x.rn > 1;--> statement-breakpoint
DELETE FROM "watches" w USING (
  SELECT "login", "kind", "target_id", row_number() OVER (PARTITION BY "kind", "target_id" ORDER BY "last_seen_at", "login") AS rn FROM "watches"
) x WHERE w."login" = x."login" AND w."kind" = x."kind" AND w."target_id" = x."target_id" AND x.rn > 1;--> statement-breakpoint
DELETE FROM "user_prefs" p USING (
  SELECT "login", row_number() OVER (ORDER BY (lower("login") = (SELECT lower("value") FROM "sync_state" WHERE "key" = 'github.login')) DESC NULLS LAST, "login") AS rn FROM "user_prefs"
) x WHERE p."login" = x."login" AND x.rn > 1;--> statement-breakpoint
UPDATE "tasks" SET "creator_login" = 'local', "completed_by" = CASE WHEN "completed_by" IS NULL THEN NULL ELSE 'local' END;--> statement-breakpoint
UPDATE "task_projects" SET "owner_login" = 'local';--> statement-breakpoint
UPDATE "task_labels" SET "owner_login" = 'local';--> statement-breakpoint
UPDATE "task_placements" SET "login" = 'local';--> statement-breakpoint
UPDATE "task_completions" SET "login" = 'local';--> statement-breakpoint
UPDATE "task_comments" SET "author_login" = 'local';--> statement-breakpoint
UPDATE "notifications" SET "login" = 'local';--> statement-breakpoint
UPDATE "user_prefs" SET "login" = 'local';--> statement-breakpoint
UPDATE "triage_snoozes" SET "login" = 'local';--> statement-breakpoint
UPDATE "watches" SET "login" = 'local';--> statement-breakpoint
ALTER TABLE "users" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "users" CASCADE;--> statement-breakpoint
DROP INDEX "tasks_assignee_idx";--> statement-breakpoint
DROP INDEX "views_owner_idx";--> statement-breakpoint
ALTER TABLE "notifications" DROP COLUMN "actor_login";--> statement-breakpoint
ALTER TABLE "tasks" DROP COLUMN "assignee_login";--> statement-breakpoint
ALTER TABLE "views" DROP COLUMN "owner_id";--> statement-breakpoint
ALTER TABLE "views" DROP COLUMN "visibility";