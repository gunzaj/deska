// D13 on PostgresTaskRepo over PGlite (the suite is shared with sections.test.ts).
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { defineSectionTests } from "./sections-suite";

defineSectionTests(async () => {
  await getDb().execute(sql`TRUNCATE tasks, task_links, task_projects, task_sections, task_placements, task_labels, task_label_links, task_reminders, task_completions, task_comments, notifications, user_prefs RESTART IDENTITY CASCADE`);
});

describe("task_sections schema", () => {
  it("deleting a project removes its sections; deleting a section nulls tasks.section_id", async () => {
    const db = getDb();
    const q = async (text: string) => (await db.execute(sql.raw(text))).rows as Record<string, unknown>[];
    await q(`INSERT INTO task_projects (id, owner_login, name) VALUES ('70000000-0000-0000-0000-000000000001', 'local', 'P')`);
    await q(`INSERT INTO task_sections (id, owner_login, project_id, name) VALUES ('70000000-0000-0000-0000-0000000000a1', 'local', '70000000-0000-0000-0000-000000000001', 'S')`);
    await q(`INSERT INTO tasks (id, creator_login, title, section_id) VALUES ('70000000-0000-0000-0000-0000000000b1', 'local', 'T', '70000000-0000-0000-0000-0000000000a1')`);
    await q(`DELETE FROM task_sections`);
    expect((await q(`SELECT section_id FROM tasks`))[0]!.section_id).toBeNull();
    await q(`INSERT INTO task_sections (id, owner_login, project_id, name) VALUES ('70000000-0000-0000-0000-0000000000a2', 'local', '70000000-0000-0000-0000-000000000001', 'S2')`);
    await q(`DELETE FROM task_projects`);
    expect(await q(`SELECT 1 FROM task_sections`)).toEqual([]);
  });
});
