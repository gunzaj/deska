CREATE TABLE "task_sections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_login" text NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"position" double precision DEFAULT 0 NOT NULL,
	"collapsed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "section_id" uuid;--> statement-breakpoint
ALTER TABLE "task_sections" ADD CONSTRAINT "task_sections_project_id_task_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."task_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_sections_project_idx" ON "task_sections" USING btree ("project_id","position");--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_section_id_task_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."task_sections"("id") ON DELETE set null ON UPDATE no action;