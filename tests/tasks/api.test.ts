// Task API against the in-memory repo and the fixture issue cache. The session
// is mocked so each call can act as a different GitHub account.
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
});

describe("/api/tasks", () => {
  it("requires a session", async () => {
    expect((await as(null, () => list(new NextRequest("http://x/api/tasks")))).status).toBe(401);
  });

  it("creates a task and renders its description", async () => {
    const { res, body } = await newTask({ title: "Finish spec", description: "See **#101**", priority: 2, dueDate: "2026-10-13" });
    expect(res.status).toBe(201);
    expect(body.task).toMatchObject({ title: "Finish spec", priority: 2, dueDate: "2026-10-13" });
    expect(body.descriptionHtml).toContain("<strong>");
  });

  it("tasks belong to this install: they stay visible after connecting a different GitHub account (D7)", async () => {
    const { body } = await newTask({ title: "Review" }, "alice");
    const id = body.task.id as string;
    for (const login of ["alice", "bob"]) {
      const r = await as(login, () => item.GET(new NextRequest(`http://x/api/tasks/${id}`), ctx(id)));
      expect(r.status).toBe(200);
      const l = await (await as(login, () => list(new NextRequest("http://x/api/tasks")))).json();
      expect(l.tasks.map((t: { id: string }) => t.id)).toContain(id);
    }
    // The new account can change and delete them too.
    const patched = await as("bob", () => item.PATCH(new NextRequest(`http://x/api/tasks/${id}`, { ...json({ title: "x" }), method: "PATCH" }), ctx(id)));
    expect(patched.status).toBe(200);
    const deleted = await as("carol", () => item.DELETE(new NextRequest(`http://x/api/tasks/${id}`, { method: "DELETE" }), ctx(id)));
    expect(deleted.status).toBe(200);
  });

  it("has no assignees: the field is dropped on create and refused on patch; the list carries no access map", async () => {
    const { res, body } = await newTask({ title: "Ask Bob", assignee: "bob" });
    expect(res.status).toBe(201);
    expect(body.task).not.toHaveProperty("assignee");
    const l = await (await as("alice", () => list(new NextRequest("http://x/api/tasks")))).json();
    expect(l).not.toHaveProperty("access");
    const id = body.task.id as string;
    const r = await as("alice", () => item.PATCH(new NextRequest(`http://x/api/tasks/${id}`, { ...json({ assignee: "bob" }), method: "PATCH" }), ctx(id)));
    expect(r.status).toBe(400);
  });

  it("completing hides from open, un-completing restores", async () => {
    const { body } = await newTask({ title: "Review PR" });
    const id = body.task.id as string;
    const patch = (b: unknown) => as("alice", () => item.PATCH(new NextRequest(`http://x/api/tasks/${id}`, { ...json(b), method: "PATCH" }), ctx(id)));
    const done = await (await patch({ completed: true })).json();
    expect(done.task.completedAt).not.toBeNull();
    const undone = await (await patch({ completed: false })).json();
    expect(undone.task.completedAt).toBeNull();
  });

  it("deleting hides the task", async () => {
    const { body } = await newTask({ title: "Drop me" });
    const id = body.task.id as string;
    const del = as("alice", () => item.DELETE(new NextRequest(`http://x/api/tasks/${id}`, { method: "DELETE" }), ctx(id)));
    expect((await del).status).toBe(200);
    const after = await as("alice", () => item.GET(new NextRequest(`http://x/api/tasks/${id}`), ctx(id)));
    expect(after.status).toBe(404);
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
