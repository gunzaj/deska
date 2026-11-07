// U1: undo through the API on the in-memory store.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

let viewer: string | null = "alice";
vi.mock("@/lib/session", () => ({ getViewerLogin: async () => viewer }));

const { GET: list, POST: create } = await import("@/app/api/tasks/route");
const item = await import("@/app/api/tasks/[id]/route");
const restoreRoute = await import("@/app/api/tasks/[id]/restore/route");
const viewsRoute = await import("@/app/api/views/route");
const viewRestore = await import("@/app/api/views/restore/route");
const { __resetTasks, taskRepo } = await import("@/lib/tasks/repo");
const { __resetViews } = await import("@/lib/views/runtime");

const json = (method: string, body: unknown) => ({ method, body: JSON.stringify(body), headers: { "content-type": "application/json" } });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
type T = { id: string; title: string; dueDate: string | null; completedAt: string | null; labels: string[]; links: { number: number }[]; updatedAt: string };

async function newTask(body: Record<string, unknown>): Promise<T> {
  const res = await create(new NextRequest("http://x/api/tasks", json("POST", body)));
  return ((await res.json()) as { task: T }).task;
}
const patch = async (id: string, body: Record<string, unknown>) => item.PATCH(new NextRequest(`http://x/api/tasks/${id}`, json("PATCH", body)), ctx(id));
const tasks = async (): Promise<T[]> => ((await (await list(new NextRequest("http://x/api/tasks"))).json()) as { tasks: T[] }).tasks;

beforeEach(() => {
  __resetTasks();
  __resetViews();
  viewer = "alice";
});

describe("task delete → restore", () => {
  it("brings the task back with its links, labels and comments", async () => {
    const t = await newTask({ title: "Spec", links: [101], labels: ["urgent"] });
    expect(t.links.map((l) => l.number)).toEqual([101]);
    await taskRepo().insertComment({ id: crypto.randomUUID(), taskId: t.id, author: "local", body: "note", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    await item.DELETE(new NextRequest(`http://x/api/tasks/${t.id}`, { method: "DELETE" }), ctx(t.id));
    expect(await tasks()).toEqual([]);

    const res = await restoreRoute.POST(new NextRequest(`http://x/api/tasks/${t.id}/restore`, { method: "POST" }), ctx(t.id));
    expect(res.status).toBe(200);
    const [back] = await tasks();
    expect(back).toMatchObject({ id: t.id, title: "Spec" });
    expect(back!.links.map((l) => l.number)).toEqual([101]);
    expect(back!.labels).toHaveLength(1);
    expect((await taskRepo().comments(t.id)).map((c) => c.body)).toEqual(["note"]);
  });

  it("restores only a deleted task, whichever GitHub account is connected", async () => {
    const t = await newTask({ title: "Mine" });
    expect((await restoreRoute.POST(new NextRequest("http://x", { method: "POST" }), ctx(t.id))).status).toBe(404);
    await item.DELETE(new NextRequest(`http://x/api/tasks/${t.id}`, { method: "DELETE" }), ctx(t.id));
    viewer = "bob";
    expect((await restoreRoute.POST(new NextRequest("http://x", { method: "POST" }), ctx(t.id))).status).toBe(200);
  });
});

describe("undo complete", () => {
  it("a plain task reopens", async () => {
    const t = await newTask({ title: "Once" });
    await patch(t.id, { completed: true });
    const res = await patch(t.id, { completed: false });
    expect(((await res.json()) as { task: T }).task.completedAt).toBeNull();
  });

  it("a recurring task gets its due date and completion row back", async () => {
    const t = await newTask({ title: "Weekly", dueDate: "2026-10-16", recurrence: { rule: "FREQ=WEEKLY", text: "every week" } });
    const done = ((await (await patch(t.id, { completed: true })).json()) as { task: T }).task;
    expect(done.dueDate).toBe("2026-10-23");
    const repo = taskRepo() as unknown as { completions: { taskId: string; dueDate: string }[] };
    expect(repo.completions.filter((c) => c.taskId === t.id).map((c) => c.dueDate)).toEqual(["2026-10-16"]);

    const undone = ((await (await patch(t.id, { undoOccurrence: "2026-10-16" })).json()) as { task: T }).task;
    expect(undone.dueDate).toBe("2026-10-16");
    expect(repo.completions.filter((c) => c.taskId === t.id)).toEqual([]);
    // A second undo has nothing to undo.
    expect((await patch(t.id, { undoOccurrence: "2026-10-09" })).status).toBe(200);
    expect((await tasks())[0]!.dueDate).toBe("2026-10-16");
    expect((await patch(t.id, { undoOccurrence: "2026-10-20" })).status).toBe(400);
  });
});

describe("view delete → restore", () => {
  it("soft-deletes and restores, and keeps the ID reserved", async () => {
    const draft = { id: "", name: "Mine", layout: "list", filters: [], sort: [] };
    const mine = (await (await viewsRoute.POST(new NextRequest("http://x/api/views", json("POST", draft)))).json()) as { id: string };
    expect((await viewsRoute.DELETE(new NextRequest(`http://x/api/views?id=${mine.id}`, { method: "DELETE" }))).status).toBe(200);
    expect(((await (await viewsRoute.GET(new NextRequest("http://x/api/views"))).json()) as { id: string }[]).some((v) => v.id === mine.id)).toBe(false);

    // Restoring something that was never deleted finds nothing.
    expect((await viewRestore.POST(new NextRequest("http://x/api/views/restore", json("POST", { id: "v-unknown" })))).status).toBe(404);

    viewer = "bob"; // another GitHub account: the view is the install's, not the account's
    expect((await viewRestore.POST(new NextRequest("http://x/api/views/restore", json("POST", { id: mine.id })))).status).toBe(200);
    expect(((await (await viewsRoute.GET(new NextRequest("http://x/api/views"))).json()) as { id: string }[]).some((v) => v.id === mine.id)).toBe(true);
  });
});
