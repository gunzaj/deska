ALTER TABLE "outbox" DROP COLUMN IF EXISTS "lease_token";--> statement-breakpoint
ALTER TABLE "outbox" ADD COLUMN "step" text;--> statement-breakpoint
ALTER TABLE "outbox" ADD COLUMN "result_json" jsonb;
