CREATE TABLE "ai_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"feature" text NOT NULL,
	"subject_kind" text NOT NULL,
	"subject" text NOT NULL,
	"input_hash" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"result" jsonb NOT NULL,
	"duration_ms" integer NOT NULL,
	"cost_usd" double precision,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accepted_at" timestamp with time zone,
	"dismissed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "ai_results_subject_idx" ON "ai_results" USING btree ("feature","subject","created_at");