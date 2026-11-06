// Task API against the in-memory repo and the fixture issue cache. The session
// is mocked so each call can act as a different user.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

let viewer: string | null = "alice";
vi.mock("@/lib/session", () => ({ getViewerLogin: async () => viewer }));

const { GET: list, POST: create } = await import("@/app/api/tasks/route");
const item = await import("@/app/api/tasks/[id]/route");
const { __resetTasks } = await import("@/lib/tasks/repo");

const json = (body: unknown) => ({ method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

async function as<T>(login: string | null, fn: () => Promise<T>): Promise<T> {
  viewer = login;
  return fn();
}

async function newTask(body: Record<string, unknown>, login = "alice") {
  const res = await as(login, () => create(new NextRequest("http://x/api/tasks", json(body))));
  return { res, body: await res.json() };
}

beforeEach(() => {
  __resetTasks();
  process.env.ALLOWED_GITHUB_LOGINS = "alice,bob";
});

describe("/api/tasks", () => {
  it("requires a session", async () => {
    expect((await as(null, () => list(new NextRequest("http://x/api/tasks")))).status).toBe(401);
  });

  it("creates a task and renders its description", async () => {
    const { res, body } = await newTask({ title: "Finish spec", description: "See **#101**", priority: 2, dueDate: "2026-10-13" });
    expect(res.status).toBe(201);
    expect(body.task).toMatchObject({ title: "Finish spec", creator: "alice", assignee: null, priority: 2, dueDate: "2026-10-13" });
    expect(body.descriptionHtml).toContain("<strong>");
  });

  it("a task is visible to creator and assignee only; others get 404", async () => {
    const { body } = await newTask({ title: "Review", assignee: "bob" });
    const id = body.task.id as string;
    for (const login of ["alice", "bob"]) {
      const r = await as(login, () => item.GET(new NextRequest(`http://x/api/tasks/${id}`), ctx(id)));
      expect(r.status).toBe(200);
      const l = await (await as(login, () => list(new NextRequest("http://x/api/tasks")))).json();
      expect(l.tasks.map((t: { id: string }) => t.id)).toContain(id);
    }
    const outsider = await as("intruder", () => item.GET(new NextRequest(`http://x/api/tasks/${id}`), ctx(id)));
    expect(outsider.status).toBe(404);
    const patched = await as("intruder", () => item.PATCH(new NextRequest(`http://x/api/tasks/${id}`, { ...json({ title: "x" }), method: "PATCH" }), ctx(id)));
    expect(patched.status).toBe(404);
    const deleted = await as("intruder", () => item.DELETE(new NextRequest(`http://x/api/tasks/${id}`, { method: "DELETE" }), ctx(id)));
    expect(deleted.status).toBe(404);
    expect((await (await as("intruder", () => list(new NextRequest("http://x/api/tasks")))).json()).tasks).toEqual([]);
  });

  it("assigning to a login that never signed in works and is marked pending; non-allowlisted is blocked", async () => {
    const { res, body } = await newTask({ title: "Ask Bob", assignee: "bob" });
    expect(res.status).toBe(201);
    expect(body.task.assignee).toBe("bob");
    const l = await (await as("alice", () => list(new NextRequest("http://x/api/tasks")))).json();
    expect(l.access.bob).toBe("pending");
    expect(l.access.alice).toBe("active");
    process.env.ALLOWED_GITHUB_LOGINS = "alice";
    const l2 = await (await as("alice", () => list(new NextRequest("http://x/api/tasks")))).json();
    expect(l2.access.bob).toBe("blocked");
  });

  it("refuses unknown assignees and treats self-assignment as unassigned", async () => {
    expect((await newTask({ title: "x", assignee: "nobody-here" })).res.status).toBe(400);
    expect((await newTask({ title: "x", assignee: "Alice" })).body.task.assignee).toBeNull();
  });

  it("completing hides from open, un-completing restores; completedBy records who", async () => {
    const { body } = await newTask({ title: "Review PR", assignee: "bob" });
    const id = body.task.id as string;
    const patch = (b: unknown, login: string) =>
      as(login, () => item.PATCH(new NextRequest(`http://x/api/tasks/${id}`, { ...json(b), method: "PATCH" }), ctx(id)));
    const done = await (await patch({ completed: true }, "bob")).json();
    expect(done.task.completedAt).not.toBeNull();
    expect(done.task.completedBy).toBe("bob");
    const undone = await (await patch({ completed: false }, "alice")).json();
    expect(undone.task.completedAt).toBeNull();
    expect(undone.task.completedBy).toBeNull();
  });

  it("only the creator can delete; the assignee gets 403", async () => {
    const { body } = await newTask({ title: "Delegate me", assignee: "bob" });
    const id = body.task.id as string;
    const del = (login: string) => as(login, () => item.DELETE(new NextRequest(`http://x/api/tasks/${id}`, { method: "DELETE" }), ctx(id)));
    expect((await del("bob")).status).toBe(403);
    expect((await del("alice")).status).toBe(200);
    const after = await as("alice", () => item.GET(new NextRequest(`http://x/api/tasks/${id}`), ctx(id)));
    expect(after.status).toBe(404);
  });

  it("reassigning away from yourself removes your access (Q3)", async () => {
    const { body } = await newTask({ title: "Hot potato", assignee: "bob" });
    const id = body.task.id as string;
    const r = await as("bob", () => item.PATCH(new NextRequest(`http://x/api/tasks/${id}`, { ...json({ assignee: null }), method: "PATCH" }), ctx(id)));
    expect((await r.json()).task.assignee).toBeNull();
    const gone = await as("bob", () => item.GET(new NextRequest(`http://x/api/tasks/${id}`), ctx(id)));
    expect(gone.status).toBe(404);
  });

  it("links issues by number; an empty title takes the issue title; unknown numbers are refused", async () => {
    const { res, body } = await newTask({ title: "", links: [101] });
    expect(res.status).toBe(201);
    expect(body.task.title).toBe("Sub: dashboard widget");
    expect(body.task.links).toEqual([{ kind: "issue", nodeId: expect.any(String), number: 101 }]);
    expect((await newTask({ title: "x", links: [99999] })).res.status).toBe(400);
    expect((await newTask({ title: "" })).res.status).toBe(400);
  });

  it("replaces the link set on patch and keeps order", async () => {
    const { body } = await newTask({ title: "Review", links: [101] });
    const id = body.task.id as string;
    const r = await as("alice", () =>
      item.PATCH(new NextRequest(`http://x/api/tasks/${id}`, { ...json({ links: [100, 101] }), method: "PATCH" }), ctx(id)),
    );
    expect((await r.json()).task.links.map((l: { number: number }) => l.number)).toEqual([100, 101]);
  });

  it("rejects malformed input with 400", async () => {
    expect((await newTask({ title: "" })).res.status).toBe(400);
    const res = await as("alice", () => create(new NextRequest("http://x/api/tasks", { method: "POST", body: "not json" })));
    expect(res.status).toBe(400);
  });
});

describe("optimistic concurrency (S9)", () => {
  it("a stale updatedAt on PATCH returns 409 with the current task", async () => {
    const { body } = await newTask({ title: "Spec" });
    const id = body.task.id as string;
    const seen = body.task.updatedAt as string;
    await new Promise((r) => setTimeout(r, 5));
    const first = await as("alice", () => item.PATCH(new NextRequest(`http://x/api/tasks/${id}`, { method: "PATCH", body: JSON.stringify({ title: "Spec v2", expectedUpdatedAt: seen }) }), ctx(id)));
    expect(first.status).toBe(200);
    const second = await as("alice", () => item.PATCH(new NextRequest(`http://x/api/tasks/${id}`, { method: "PATCH", body: JSON.stringify({ title: "Spec v3", expectedUpdatedAt: seen }) }), ctx(id)));
    expect(second.status).toBe(409);
    const conflict = await second.json();
    expect(conflict.current.task.title).toBe("Spec v2");
  });
});
