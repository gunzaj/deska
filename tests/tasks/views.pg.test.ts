// Item 12 against Postgres: saved task views share the `views` table with the
// issue views, told apart by `kind`, through the runtime and the API route.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { NextRequest } from "next/server";

vi.mock("@/lib/session", () => ({ getViewerLogin: async () => "alice" }));
import { getDb } from "@/db";
import { GET as viewsGet, POST as viewsPost, DELETE as viewsDelete } from "@/app/api/views/route";
import { getTaskView, taskViewsFor } from "@/lib/tasks/views-runtime";
import type { TaskView } from "@/lib/tasks/views";
import { saveView, viewsFor } from "@/lib/views/runtime";
import type { View } from "@/lib/views/view";

const json = (url: string, body: unknown, method = "POST") => new NextRequest(`http://127.0.0.1:3000${url}`, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const get = (url: string) => new NextRequest(`http://127.0.0.1:3000${url}`);

const ISSUE_VIEW: View = { id: "v-issue", name: "All issues", layout: "list", filters: [], sort: [] };

beforeEach(async () => {
  await getDb().execute(sql`TRUNCATE views`);
});

describe("saved task views (Postgres)", () => {
  it("saves, lists, renames and deletes one without touching the issue views", async () => {
    await saveView(ISSUE_VIEW);
    const created = (await (await viewsPost(json("/api/views", { kind: "tasks", name: "Urgent", filter: { priority: 1 } }))).json()) as TaskView;
    expect(created).toMatchObject({ kind: "tasks", name: "Urgent", filter: { priority: 1 } });
    expect(created.id).toMatch(/^v-/);

    expect(await (await viewsGet(get("/api/views?kind=tasks"))).json()).toEqual([created]);
    // The issue views are untouched: the task view is not one.
    const issueViews = (await (await viewsGet(get("/api/views"))).json()) as View[];
    expect(issueViews.some((v) => v.id === ISSUE_VIEW.id)).toBe(true);
    expect(issueViews.some((v) => v.id === created.id)).toBe(false);
    expect(await getTaskView(created.id)).toMatchObject({ name: "Urgent" });
    expect((await viewsFor()).some((v) => v.id === created.id)).toBe(false);

    const renamed = (await (await viewsPost(json("/api/views", { id: created.id, kind: "tasks", name: "Urgent today", filter: { due: "today" } }))).json()) as TaskView;
    expect(renamed).toMatchObject({ id: created.id, name: "Urgent today", filter: { due: "today" } });
    expect(await taskViewsFor()).toEqual([renamed]);

    expect((await viewsDelete(new NextRequest(`http://127.0.0.1:3000/api/views?id=${created.id}&kind=tasks`, { method: "DELETE" }))).status).toBe(200);
    expect(await taskViewsFor()).toEqual([]);
    expect(await getTaskView(created.id)).toBeNull();
    expect((await viewsFor()).some((v) => v.id === ISSUE_VIEW.id)).toBe(true);
  });

  it("never reuses an issue view's ID for a task view", async () => {
    await saveView(ISSUE_VIEW);
    const created = (await (await viewsPost(json("/api/views", { id: ISSUE_VIEW.id, kind: "tasks", name: "Mine", filter: {} }))).json()) as TaskView;
    expect(created.id).not.toBe(ISSUE_VIEW.id);
    expect((await viewsFor()).find((v) => v.id === ISSUE_VIEW.id)).toEqual(ISSUE_VIEW);
  });

  it("refuses a task view that breaks its strict schema", async () => {
    expect((await viewsPost(json("/api/views", { kind: "tasks", name: "Bad", filter: { priority: 9 } }))).status).toBe(400);
    expect((await viewsPost(json("/api/views", { kind: "tasks", name: "", filter: {} }))).status).toBe(400);
    expect((await viewsPost(json("/api/views", { kind: "tasks", name: "Bad", filter: { extra: true } }))).status).toBe(400);
    expect(await taskViewsFor()).toEqual([]);
  });
});
