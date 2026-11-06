CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_item_dims" (
	"item_id" uuid NOT NULL,
	"field_id" text NOT NULL,
	"option_id" text NOT NULL,
	CONSTRAINT "project_item_dims_item_id_field_id_pk" PRIMARY KEY("item_id","field_id")
);
--> statement-breakpoint
DROP INDEX "project_items_team_idx";--> statement-breakpoint
ALTER TABLE "project_fields" ADD COLUMN "missing_at" timestamp;--> statement-breakpoint
ALTER TABLE "project_item_dims" ADD CONSTRAINT "project_item_dims_item_id_project_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."project_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_item_dims_field_idx" ON "project_item_dims" USING btree ("field_id","option_id");--> statement-breakpoint
-- D4: carry the values of the fields the old automatic map knew (sync_state
-- "fields.map") into project_item_dims, keyed by field ID, and point saved
-- views at the dimension keys, before the old columns go.
INSERT INTO "project_item_dims" ("item_id", "field_id", "option_id")
SELECT pi."id", m."field_id", m."opt"
FROM "project_items" pi
CROSS JOIN (SELECT ("value"::jsonb) AS map FROM "sync_state" WHERE "key" = 'fields.map' AND "value" LIKE '{%') fm
CROSS JOIN LATERAL (VALUES
  (fm.map->'status'->>'id', pi."status_opt"),
  (fm.map->'priority'->>'id', pi."priority_opt"),
  (fm.map->'team'->>'id', pi."team_opt"),
  (fm.map->'platform'->>'id', pi."platform_opt")
) AS m("field_id", "opt")
WHERE m."field_id" IS NOT NULL AND m."opt" IS NOT NULL
ON CONFLICT DO NOTHING;--> statement-breakpoint
UPDATE "views" SET "definition_json" = replace("definition_json"::text, '"team"', '"dim:' || fm.id || '"')::jsonb
FROM (SELECT ("value"::jsonb)->'team'->>'id' AS id FROM "sync_state" WHERE "key" = 'fields.map' AND "value" LIKE '{%') fm
WHERE fm.id IS NOT NULL;--> statement-breakpoint
UPDATE "views" SET "definition_json" = replace("definition_json"::text, '"platform"', '"dim:' || fm.id || '"')::jsonb
FROM (SELECT ("value"::jsonb)->'platform'->>'id' AS id FROM "sync_state" WHERE "key" = 'fields.map' AND "value" LIKE '{%') fm
WHERE fm.id IS NOT NULL;--> statement-breakpoint
DELETE FROM "sync_state" WHERE "key" = 'fields.map';--> statement-breakpoint
ALTER TABLE "project_items" DROP COLUMN "team_opt";--> statement-breakpoint
ALTER TABLE "project_items" DROP COLUMN "platform_opt";