// A task project's GitHub source (§12.3): saved issue and PR filters, shown
// live next to the project's tasks, minus items an open task there links.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { buildClientData } from "@/lib/client/build";
import { hydrate } from "@/lib/client/hydrate";
import { NEW_SOURCE, sourceRows } from "@/lib/client/project-source";
import type { ClientPr } from "@/lib/client/types";
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

function pr(p: Partial<ClientPr>): ClientPr {
  return {
    nodeId: `PR_${p.number ?? 1}`,
    number: 1,
    title: "Fix send flow",
    state: "open",
    isDraft: false,
    author: "bob",
    url: "",
    headRef: "fix/send",
    baseRef: "develop",
    reviewDecision: null,
    checksState: null,
    milestoneId: null,
    additions: 1,
    deletions: 1,
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-05T00:00:00Z",
    closedAt: null,
    mergedAt: null,
    labelIds: [],
    assignees: [],
    reviewRequests: [],
    reviews: [],
    closingIssues: [],
    ...p,
  };
}
const prCtx = { me: "alice", myTeams: [] };

describe("sourceRows", () => {
  it("pulls in nothing without a source, or until a filter narrows the state", async () => {
    const data = await client();
    const all = { meta: data.meta, issues: data.issues, prs: [pr({})], prCtx };
    expect(sourceRows(null, [], all)).toEqual({ issues: [], prs: [] });
    expect(sourceRows(NEW_SOURCE, [], all)).toEqual({ issues: [], prs: [] });
  });

  it("matches issues and PRs by the saved filters and leaves out ones an open task links", async () => {
    const data = await client();
    const labelled = data.issues.find((i) => i.labelIds.length)!;
    const label = labelled.labelIds[0]!;
    const expected = data.issues.filter((i) => i.state === "open" && i.labelIds.includes(label));
    expect(expected.length).toBeGreaterThan(0);
    const prs = [pr({ number: 1, author: "alice" }), pr({ number: 2, author: "bob" }), pr({ number: 3, author: "alice", state: "merged" })];
    const source = {
      issues: [...NEW_SOURCE.issues!, { field: "label" as const, op: "in" as const, values: [label] }],
      prs: [...NEW_SOURCE.prs!, { field: "author" as const, values: ["me"] }],
    };
    const all = { meta: data.meta, issues: data.issues, prs, prCtx };

    const rows = sourceRows(source, [], all);
    expect(rows.issues.map((i) => i.number).sort()).toEqual(expected.map((i) => i.number).sort());
    expect(rows.prs.map((p) => p.number)).toEqual([1]);

    const first = expected[0]!;
    const link = (nodeId: string, number: number, kind: "issue" | "pr") => ({ kind, nodeId, number });
    const open = { completedAt: null, links: [link(first.nodeId, first.number, "issue"), link("PR_1", 1, "pr")] };
    const linked = sourceRows(source, [open], all);
    expect(linked.issues.map((i) => i.number)).not.toContain(first.number);
    expect(linked.prs).toEqual([]);
    // A completed task no longer stands for the item.
    expect(sourceRows(source, [{ ...open, completedAt: "2026-10-10T00:00:00Z" }], all).prs.map((p) => p.number)).toEqual([1]);
  });
});

describe("project source API", () => {
  beforeEach(() => {
    __resetTasks();
    process.env.ALLOWED_GITHUB_LOGINS = "alice,bob";
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
    const source = { issues: [{ field: "label", op: "in", values: ["L1"] }], prs: null };
    expect((await patch(id, { source })).body.source).toEqual(source);
    expect((await projects())[0]!.source).toEqual(source);
    expect((await patch(id, { source: null })).body.source).toBeNull();
  });

  it("treats both kinds off as no source", async () => {
    const id = await newProject();
    expect((await patch(id, { source: { issues: null, prs: null } })).body.source).toBeNull();
  });

  it("refuses malformed filters and other people's projects", async () => {
    const id = await newProject();
    expect((await patch(id, { source: { issues: [{ field: "nope" }], prs: null } })).status).toBe(400);
    expect((await patch(id, { source: { issues: null, prs: [{ field: "state", values: ["weird"] }] } })).status).toBe(400);
    expect((await patch(id, { source: NEW_SOURCE }, "bob")).status).toBe(404);
  });
});
