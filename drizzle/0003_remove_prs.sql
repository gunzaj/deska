DROP TABLE "gh_team_members" CASCADE;--> statement-breakpoint
DROP TABLE "pr_assignees" CASCADE;--> statement-breakpoint
DROP TABLE "pr_issue_links" CASCADE;--> statement-breakpoint
DROP TABLE "pr_labels" CASCADE;--> statement-breakpoint
DROP TABLE "pr_review_requests" CASCADE;--> statement-breakpoint
DROP TABLE "pr_reviews" CASCADE;--> statement-breakpoint
DROP TABLE "pull_requests" CASCADE;--> statement-breakpoint
-- D6: pull requests are gone. Clear what local data still points at them, so
-- the strict schemas (views, project sources, sidebar) parse every stored row.
DELETE FROM "task_links" WHERE "target_kind" = 'pr';--> statement-breakpoint
DELETE FROM "views" WHERE "definition_json"->>'entity' = 'pr';--> statement-breakpoint
UPDATE "views" SET "definition_json" = "definition_json" - 'entity' - 'pr' WHERE "definition_json" ?| array['entity', 'pr'];--> statement-breakpoint
UPDATE "task_projects" SET "source" = CASE
  WHEN jsonb_typeof("source"->'issues') = 'array' THEN jsonb_build_object('issues', "source"->'issues')
  ELSE NULL
END WHERE "source" IS NOT NULL AND jsonb_typeof("source") = 'object';--> statement-breakpoint
UPDATE "user_prefs" SET "sidebar" = jsonb_build_object(
  'order', COALESCE((SELECT jsonb_agg(e) FROM jsonb_array_elements("sidebar"->'order') e WHERE e <> '"pulls"'::jsonb), '[]'::jsonb),
  'hidden', COALESCE((SELECT jsonb_agg(e) FROM jsonb_array_elements("sidebar"->'hidden') e WHERE e <> '"pulls"'::jsonb), '[]'::jsonb)
) WHERE "sidebar" IS NOT NULL AND jsonb_typeof("sidebar"->'order') = 'array' AND jsonb_typeof("sidebar"->'hidden') = 'array';--> statement-breakpoint
DELETE FROM "sync_state" WHERE "key" = 'prs.lastScan';
