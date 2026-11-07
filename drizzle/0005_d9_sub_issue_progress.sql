ALTER TABLE "issues" ADD COLUMN "sub_total" integer;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "sub_completed" integer;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "sub_summary_at" timestamp;--> statement-breakpoint
-- Existing caches have no counts yet: make the next launch reconcile, which fills them.
DELETE FROM "sync_state" WHERE "key" = 'reconcile.lastRun';
