// T6: task comments through the API (SPEC §12.7), in-memory repo, mocked session.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

let viewer: string | null = "alice";
vi.mock("@/lib/session", () => ({ getViewerLogin: async () => viewer }));

const tasksRoute = await import("@/app/api/tasks/route");
const taskRoute = await import("@/app/api/tasks/[id]/route");
const commentsRoute = await import("@/app/api/tasks/[id]/comments/route");
const commentRoute = await import("@/app/api/tasks/[id]/comments/[cid]/route");
const notesRoute = await import("@/app/api/notifications/route");
const { __resetTasks } = await import("@/lib/tasks/repo");

const req = (method: string, body?: unknown) =>
  new NextRequest("http://x/api", { method, ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }) });
async function as<T>(login: string, fn: () => Promise<Response>): Promise<{ status: number; body: T }> {
  viewer = login;
  const r = await fn();
  return { status: r.status, body: (await r.json()) as T };
}
type C = { id: string; author: string; body: string; bodyHtml: string };
const post = (task: string, body: string, login = "alice") => as<C>(login, () => commentsRoute.POST(req("POST", { body }), { params: Promise.resolve({ id: task }) }));
const list = (task: string, login = "alice") => as<C[]>(login, () => commentsRoute.GET(req("GET"), { params: Promise.resolve({ id: task }) }));
const ctx2 = (id: string, cid: string) => ({ params: Promise.resolve({ id, cid }) });
const notes = (login: string) => as<{ list: { kind: string; actor: string }[] }>(login, () => notesRoute.GET(req("GET")));

let taskId = "";
beforeEach(async () => {
  __resetTasks();
  const r = await as<{ task: { id: string } }>("alice", () => tasksRoute.POST(req("POST", { title: "Spec review", assignee: "bob" })));
  taskId = r.body.task.id;
});

describe("task comments (§12.7)", () => {
  it("creator and assignee can read and post; others get 404", async () => {
    expect((await post(taskId, "Can you check **error states**?")).status).toBe(201);
    expect((await post(taskId, "On it", "bob")).status).toBe(201);
    const l = await list(taskId, "bob");
    expect(l.body.map((c) => [c.author, c.body])).toEqual([
      ["alice", "Can you check **error states**?"],
      ["bob", "On it"],
    ]);
    expect(l.body[0]!.bodyHtml).toContain("<strong>error states</strong>");
    expect((await list(taskId, "intruder")).status).toBe(404);
    expect((await post(taskId, "hi", "intruder")).status).toBe(404);
  });

  it("notifies the other participants, never the author", async () => {
    await post(taskId, "ping");
    const m = await notes("bob");
    expect(m.body.list.filter((n) => n.kind === "comment")).toEqual([expect.objectContaining({ actor: "alice" })]);
    expect((await notes("alice")).body.list.filter((n) => n.kind === "comment")).toEqual([]);
  });

  it("only the author edits or deletes a comment; empty comments are refused", async () => {
    const c = await post(taskId, "first");
    expect((await as("bob", () => commentRoute.PATCH(req("PATCH", { body: "hijack" }), ctx2(taskId, c.body.id)))).status).toBe(403);
    expect((await as("bob", () => commentRoute.DELETE(req("DELETE"), ctx2(taskId, c.body.id)))).status).toBe(403);
    const edited = await as<C>("alice", () => commentRoute.PATCH(req("PATCH", { body: "second" }), ctx2(taskId, c.body.id)));
    expect(edited.body.body).toBe("second");
    expect((await as("alice", () => commentRoute.DELETE(req("DELETE"), ctx2(taskId, c.body.id)))).status).toBe(200);
    expect((await list(taskId)).body).toEqual([]);
    expect((await post(taskId, "   ")).status).toBe(400);
  });

  it("deleting the task deletes its comments and notifications", async () => {
    await post(taskId, "soon gone");
    await as("alice", () => taskRoute.DELETE(req("DELETE"), { params: Promise.resolve({ id: taskId }) }));
    expect((await list(taskId)).status).toBe(404);
    expect((await notes("bob")).body.list).toEqual([]);
  });
});
