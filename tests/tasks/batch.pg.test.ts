// Item 13 against Postgres: Ramble's one batch create — all tasks or none,
// and a retry with the same key never duplicates them.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { NextRequest } from "next/server";

vi.mock("@/lib/session", () => ({ getViewerLogin: async () => "alice" }));

const { getDb } = await import("@/db");
const { POST } = await import("@/app/api/tasks/batch/route");
const { __resetBatches } = await import("@/lib/tasks/batches");
const { createTasks, createProject } = await import("@/lib/tasks/service");
const { listTasks } = await import("@/lib/tasks/service");
const { LOCAL_OWNER } = await import("@/lib/local-owner");

const json = (body: unknown) => new NextRequest("http://127.0.0.1:3000/api/tasks/batch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const count = async () => Number((await getDb().execute(sql`SELECT count(*)::int AS n FROM tasks`)).rows[0]!.n);
const input = (over: Record<string, unknown> = {}) => ({ title: "Task", description: "", priority: 4 as const, dueDate: null, dueTime: null, recurrence: null, reminders: [], links: [], parentId: null, projectId: null, sectionId: null, labels: [], ...over });

beforeEach(async () => {
  __resetBatches();
  await getDb().execute(sql`TRUNCATE tasks, task_placements, task_labels, task_label_links, task_projects, task_sections RESTART IDENTITY CASCADE`);
});

describe("batch create (item 13)", () => {
  it("creates every task in one batch", async () => {
    const r = await createTasks(LOCAL_OWNER, [input({ title: "Buy milk" }), input({ title: "Call the dentist", priority: 1 })]);
    expect(r.ok).toBe(true);
    expect(r.ok && r.value.map((t) => t.title)).toEqual(["Buy milk", "Call the dentist"]);
    expect((await listTasks(LOCAL_OWNER)).tasks.map((t) => t.title).sort()).toEqual(["Buy milk", "Call the dentist"]);
  });

  it("creates none when one task in the batch is refused", async () => {
    const project = await createProject(LOCAL_OWNER, { name: "Home", color: "blue" });
    expect(project.ok).toBe(true);
    const bad = await createTasks(LOCAL_OWNER, [input({ title: "First" }), input({ title: "Second", sectionId: "00000000-0000-4000-8000-000000000001", projectId: project.ok ? project.value.id : null })]);
    expect(bad).toMatchObject({ ok: false, status: 400 });
    expect(await count()).toBe(0);
  });

  it("a retry with the same key returns the first tasks and makes no duplicates", async () => {
    const body = { idempotencyKey: "ramble-test-1", tasks: [input({ title: "Buy milk" }), input({ title: "Call the dentist" })] };
    const first = await POST(json(body));
    expect(first.status).toBe(201);
    const firstBody = (await first.json()) as { tasks: { id: string }[] };
    expect(firstBody.tasks).toHaveLength(2);
    const again = await POST(json(body));
    expect(again.status).toBe(200);
    const againBody = (await again.json()) as { tasks: { id: string }[] };
    expect(againBody.tasks.map((t) => t.id)).toEqual(firstBody.tasks.map((t) => t.id));
    expect(await count()).toBe(2);
  });

  it("refuses an empty batch and an empty key", async () => {
    expect((await POST(json({ idempotencyKey: "k", tasks: [] }))).status).toBe(400);
    expect((await POST(json({ idempotencyKey: "", tasks: [input()] }))).status).toBe(400);
    expect(await count()).toBe(0);
  });
});
