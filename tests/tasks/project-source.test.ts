// A task project's GitHub source (§12.3): saved issue filters, shown live next
// to the project's tasks, minus issues an open task there links.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { buildClientData } from "@/lib/client/build";
import { hydrate } from "@/lib/client/hydrate";
import { NEW_SOURCE, sourceRows } from "@/lib/client/project-source";
import { importFull } from "@/lib/sync/import";
import { MemoryStore } from "@/lib/sync/store-memory";
import { fixtureSnapshot } from "../fixtures/github";

let viewer: string | null = "alice";
vi.mock("@/lib/session", () => ({ getViewerLogin: async () => viewer }));

const projectsRoute = await import("@/app/api/task-projects/route");
const projectRoute = await import("@/app/api/task-projects/[id]/route");
const tasksRoute = await import("@/app/api/tasks/route");
const { __resetTasks } = await import("@/lib/tasks/repo");

const req = (method: string, body?: unknown) =>
  new NextRequest("http://x/api", { method, ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

async function client() {
  const store = new MemoryStore();
  await importFull(fixtureSnapshot(), store);
  return hydrate(buildClientData(store, { viewer: "alice", writeMode: false, demo: true, now: new Date("2026-10-12T10:00:00Z") }));
}


describe("sourceRows", () => {
  it("pulls in nothing without a source, or until a filter narrows the state", async () => {
    const data = await client();
    const all = { meta: data.meta, issues: data.issues };
    expect(sourceRows(null, [], all)).toEqual([]);
    expect(sourceRows(NEW_SOURCE, [], all)).toEqual([]);
  });

  it("matches issues by the saved filters and leaves out ones an open task links", async () => {
    const data = await client();
    const labelled = data.issues.find((i) => i.labelIds.length)!;
    const label = labelled.labelIds[0]!;
    const expected = data.issues.filter((i) => i.state === "open" && i.labelIds.includes(label));
    expect(expected.length).toBeGreaterThan(0);
    const source = { issues: [...NEW_SOURCE.issues!, { field: "label" as const, op: "in" as const, values: [label] }] };
    const all = { meta: data.meta, issues: data.issues };

    expect(sourceRows(source, [], all).map((i) => i.number).sort()).toEqual(expected.map((i) => i.number).sort());

    const first = expected[0]!;
    const open = { completedAt: null, links: [{ kind: "issue" as const, nodeId: first.nodeId, number: first.number }] };
    expect(sourceRows(source, [open], all).map((i) => i.number)).not.toContain(first.number);
    // A completed task no longer stands for the issue.
    expect(sourceRows(source, [{ ...open, completedAt: "2026-10-10T00:00:00Z" }], all).map((i) => i.number)).toContain(first.number);
  });
});

describe("project source API", () => {
  beforeEach(() => {
    __resetTasks();
    viewer = "alice";
  });

  const newProject = async () => {
    const r = await projectsRoute.POST(req("POST", { name: "Send flow" }));
    return ((await r.json()) as { id: string }).id;
  };
  const patch = async (id: string, body: unknown, login = "alice") => {
    viewer = login;
    const r = await projectRoute.PATCH(req("PATCH", body), ctx(id));
    return { status: r.status, body: (await r.json()) as { source?: unknown } };
  };
  const projects = async () => {
    viewer = "alice";
    return ((await (await tasksRoute.GET(req("GET"))).json()) as { projects: { id: string; source: unknown }[] }).projects;
  };

  it("starts without a source, saves one, and clears it", async () => {
    const id = await newProject();
    expect((await projects())[0]!.source).toBeNull();
    const source = { issues: [{ field: "label", op: "in", values: ["L1"] }] };
    expect((await patch(id, { source })).body.source).toEqual(source);
    expect((await projects())[0]!.source).toEqual(source);
    expect((await patch(id, { source: null })).body.source).toBeNull();
  });

  it("treats both kinds off as no source", async () => {
    const id = await newProject();
    expect((await patch(id, { source: { issues: null } })).body.source).toBeNull();
  });

  it("refuses malformed filters", async () => {
    const id = await newProject();
    expect((await patch(id, { source: { issues: [{ field: "nope" }] } })).status).toBe(400);
    // Pull request filters went with D6: a stale client sending them is refused.
    expect((await patch(id, { source: { issues: null, prs: [{ field: "state", values: ["open"] }] } })).status).toBe(400);
  });
});
