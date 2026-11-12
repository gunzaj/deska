ALTER TABLE "views" ADD COLUMN "kind" text DEFAULT 'issues' NOT NULL;--> statement-breakpoint
CREATE INDEX "views_kind_idx" ON "views" USING btree ("kind");