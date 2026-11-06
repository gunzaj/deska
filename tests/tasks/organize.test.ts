// T4: projects, placements, personal labels and sub-tasks through the API,
// on the in-memory repo with a mocked session.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

let viewer: string | null = "alice";
vi.mock("@/lib/session", () => ({ getViewerLogin: async () => viewer }));

const tasksRoute = await import("@/app/api/tasks/route");
const taskRoute = await import("@/app/api/tasks/[id]/route");
const projectsRoute = await import("@/app/api/task-projects/route");
const projectRoute = await import("@/app/api/task-projects/[id]/route");
const labelsRoute = await import("@/app/api/task-labels/route");
const labelRoute = await import("@/app/api/task-labels/[id]/route");
const { __resetTasks } = await import("@/lib/tasks/repo");

type J = Record<string, unknown>;
const req = (method: string, body?: unknown) =>
  new NextRequest("http://x/api", { method, ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

async function as<T>(login: string, fn: () => Promise<Response>): Promise<{ status: number; body: T }> {
  viewer = login;
  const r = await fn();
  return { status: r.status, body: (await r.json()) as T };
}
const create = (body: J, login = "alice") => as<{ task: J & { id: string } }>(login, () => tasksRoute.POST(req("POST", body)));
const patch = (id: string, body: J, login = "alice") => as<{ task: J }>(login, () => taskRoute.PATCH(req("PATCH", body), ctx(id)));
const list = (login = "alice") =>
  as<{ tasks: (J & { id: string })[]; projects: (J & { id: string })[]; labels: (J & { id: string; name: string })[] }>(login, () => tasksRoute.GET(req("GET")));

beforeEach(() => {
  __resetTasks();
  process.env.ALLOWED_GITHUB_LOGINS = "alice,bob";
});

describe("projects and placement (§12.3, Q2)", () => {
  it("two projects with one name created at once: one wins, the other gets 409, no duplicate (v5 4.9)", async () => {
    viewer = "alice";
    const [a, b] = await Promise.all([projectsRoute.POST(req("POST", { name: "Racers", color: "blue" })), projectsRoute.POST(req("POST", { name: "racers", color: "red" }))]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect((await list()).body.projects.filter((p) => String(p.name).toLowerCase() === "racers")).toHaveLength(1);
  });

  it("creates a project and files a new task in it; the assignee's copy lands in their Inbox", async () => {
    const p = await as<{ id: string }>("alice", () => projectsRoute.POST(req("POST", { name: "Specs", color: "blue" })));
    expect(p.status).toBe(201);
    const { body } = await create({ title: "Send flow", projectId: p.body.id, assignee: "bob" });
    expect(body.task.projectId).toBe(p.body.id);

    const mine = await list("alice");
    expect(mine.body.projects.map((x) => x.name)).toEqual(["Specs"]);
    const theirs = await list("bob");
    expect(theirs.body.projects).toEqual([]); // never sees my project names
    expect(theirs.body.tasks[0]?.projectId).toBeNull();

    // Bob files it in his own project; mine is unchanged.
    const mp = await as<{ id: string }>("bob", () => projectsRoute.POST(req("POST", { name: "Reviews" })));
    expect((await patch(body.task.id, { projectId: mp.body.id }, "bob")).body.task.projectId).toBe(mp.body.id);
    expect((await list("alice")).body.tasks[0]?.projectId).toBe(p.body.id);
  });

  it("refuses someone else's or an archived project; only the owner can change a project", async () => {
    const p = await as<{ id: string }>("alice", () => projectsRoute.POST(req("POST", { name: "Specs" })));
    expect((await create({ title: "x", projectId: p.body.id }, "bob")).status).toBe(400);
    expect((await as("bob", () => projectRoute.PATCH(req("PATCH", { name: "Mine" }), ctx(p.body.id)))).status).toBe(404);
    expect((await as("alice", () => projectRoute.PATCH(req("PATCH", { archived: true }), ctx(p.body.id)))).status).toBe(200);
    expect((await create({ title: "x", projectId: p.body.id })).status).toBe(400);
    expect((await list()).body.projects[0]).toMatchObject({ archived: true });
  });

  it("new tasks go to the end; position can be set for manual order", async () => {
    const a = await create({ title: "a" });
    const b = await create({ title: "b" });
    expect(Number(b.body.task.position)).toBeGreaterThan(Number(a.body.task.position));
    const moved = await patch(b.body.task.id, { position: Number(a.body.task.position) - 0.5 });
    expect(Number(moved.body.task.position)).toBeLessThan(Number(a.body.task.position));
  });
});

describe("personal labels (§12.3, Q4)", () => {
  it("quick-add names create labels; each person sees only their own on a shared task", async () => {
    const { body } = await create({ title: "Spec", labels: ["spec", "Design"], assignee: "bob" });
    const mine = await list();
    expect(mine.body.labels.map((l) => l.name)).toEqual(["Design", "spec"]);
    expect(body.task.labels).toHaveLength(2);

    await patch(body.task.id, { labels: ["later"] }, "bob");
    const theirs = await list("bob");
    expect(theirs.body.labels.map((l) => l.name)).toEqual(["later"]);
    expect(theirs.body.tasks[0]?.labels).toHaveLength(1);
    // Bob's change did not touch my labels on the task.
    expect((await list()).body.tasks[0]?.labels).toHaveLength(2);
  });

  it("reuses labels case-insensitively; rename conflicts are refused; delete unlinks", async () => {
    await create({ title: "a", labels: ["Spec"] });
    await create({ title: "b", labels: ["spec"] });
    const l = await list();
    expect(l.body.labels).toHaveLength(1);
    const dup = await as("alice", () => labelsRoute.POST(req("POST", { name: "SPEC" })));
    expect(dup.status).toBe(400);
    const other = await as<{ id: string }>("alice", () => labelsRoute.POST(req("POST", { name: "design" })));
    expect((await as("alice", () => labelRoute.PATCH(req("PATCH", { name: "spec" }), ctx(other.body.id)))).status).toBe(400);
    expect((await as("bob", () => labelRoute.DELETE(req("DELETE"), ctx(l.body.labels[0]!.id)))).status).toBe(404);
    expect((await as("alice", () => labelRoute.DELETE(req("DELETE"), ctx(l.body.labels[0]!.id)))).status).toBe(200);
    expect((await list()).body.tasks.every((t) => (t.labels as string[]).length === 0)).toBe(true);
  });
});

describe("sub-tasks (§12.1, §12.2)", () => {
  it("a sub-task is visible to anyone who can see its parent", async () => {
    const parent = await create({ title: "Release Sprint 23", assignee: "bob" });
    const child = await create({ title: "Changelog", parentId: parent.body.task.id });
    expect(child.body.task.parentId).toBe(parent.body.task.id);
    // Bob sees the parent, so he sees the sub-task, though it isn't his.
    expect((await list("bob")).body.tasks.map((t) => t.title).sort()).toEqual(["Changelog", "Release Sprint 23"]);
  });

  it("a sub-task can't have sub-tasks, and an invisible parent is refused", async () => {
    const parent = await create({ title: "p" });
    const child = await create({ title: "c", parentId: parent.body.task.id });
    expect((await create({ title: "g", parentId: child.body.task.id })).status).toBe(400);
    expect((await create({ title: "x", parentId: parent.body.task.id }, "bob")).status).toBe(400);
  });

  it("completing a parent with cascade completes its open sub-tasks; delete removes them", async () => {
    const parent = await create({ title: "p" });
    const c1 = await create({ title: "c1", parentId: parent.body.task.id });
    await create({ title: "c2", parentId: parent.body.task.id });
    await patch(parent.body.task.id, { completed: true });
    expect((await list()).body.tasks.filter((t) => !t.completedAt).map((t) => t.title).sort()).toEqual(["c1", "c2"]);
    await patch(parent.body.task.id, { completed: false });
    await patch(parent.body.task.id, { completed: true, cascade: true });
    expect((await list()).body.tasks.every((t) => t.completedAt)).toBe(true);

    await as("alice", () => taskRoute.DELETE(req("DELETE"), ctx(parent.body.task.id)));
    expect((await as("alice", () => taskRoute.GET(req("GET"), ctx(c1.body.task.id)))).status).toBe(404);
  });

  it("deleting a parent also removes sub-tasks the assignee added", async () => {
    const parent = await create({ title: "Release", assignee: "bob" });
    const theirs = await create({ title: "Bob's step", parentId: parent.body.task.id }, "bob");
    await as("alice", () => taskRoute.DELETE(req("DELETE"), ctx(parent.body.task.id)));
    // Bob created it, so he would still see it if it had been left behind.
    expect((await as("bob", () => taskRoute.GET(req("GET"), ctx(theirs.body.task.id)))).status).toBe(404);
    expect((await list("bob")).body.tasks).toEqual([]);
  });

  it("completing a recurring parent with cascade leaves its sub-tasks open for the next occurrence", async () => {
    const parent = await create({ title: "Weekly report", dueDate: "2026-10-16", recurrence: { rule: "FREQ=WEEKLY", text: "every week" } });
    await create({ title: "Collect numbers", parentId: parent.body.task.id });
    const done = await patch(parent.body.task.id, { completed: true, cascade: true });
    expect(done.body.task).toMatchObject({ dueDate: "2026-10-23", completedAt: null });
    expect((await list()).body.tasks.every((t) => !t.completedAt)).toBe(true);
  });
});

describe("memory repo parity", () => {
  it("maxPosition is the real maximum, like SQL max(), even below 0", async () => {
    const { MemoryTaskRepo } = await import("@/lib/tasks/repo");
    const repo = new MemoryTaskRepo();
    expect(await repo.maxPosition("a", null)).toBe(0);
    await repo.setPlacement("t1", "a", { projectId: null, position: -5 });
    await repo.setPlacement("t2", "a", { projectId: null, position: -3 });
    expect(await repo.maxPosition("a", null)).toBe(-3);
  });
});

describe("label creation races", () => {
  it("two tasks creating the same new label at once share one label", async () => {
    const [a, b] = await Promise.all([create({ title: "A", labels: ["Urgent"] }), create({ title: "B", labels: ["urgent"] })]);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    const { body } = await list();
    expect(body.labels.filter((l) => l.name.toLowerCase() === "urgent")).toHaveLength(1);
    expect(a.body.task.labels).toEqual(b.body.task.labels);
  });
});

describe("sub-task edit rights (§12.2)", () => {
  it("seeing a sub-task through its parent is read-only, apart from your own filing", async () => {
    const parent = await create({ title: "Release", assignee: "bob" });
    const sub = await create({ title: "Changelog", parentId: parent.body.task.id });
    expect((await patch(sub.body.task.id, { title: "Mine now" }, "bob")).status).toBe(403);
    expect((await patch(sub.body.task.id, { completed: true }, "bob")).status).toBe(403);
    expect((await patch(sub.body.task.id, { labels: ["later"] }, "bob")).status).toBe(200);
    // The parent's assignee may still complete the parent and its sub-tasks with it.
    expect((await patch(parent.body.task.id, { completed: true, cascade: true }, "bob")).status).toBe(200);
    const { body } = await list();
    expect(body.tasks.find((t) => t.id === sub.body.task.id)?.completedAt).toBeTruthy();
  });
});
