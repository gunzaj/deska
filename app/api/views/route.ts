import { z } from "zod";
import { HttpError, route } from "@/lib/server/route";
import { deleteTaskView, submitTaskView, taskViewsFor } from "@/lib/tasks/views-runtime";
import { taskViewSchema } from "@/lib/tasks/views";
import { deleteView, newViewId, submitView, viewsFor } from "@/lib/views/runtime";
import { viewSchema } from "@/lib/views/view";

export const dynamic = "force-dynamic";

// Saved views are Deska's only own data (SPEC §1); nothing here touches GitHub.

export const GET = route(
  { auth: "viewer", query: z.object({ kind: z.enum(["issues", "tasks"]).default("issues") }) },
  ({ query }) => (query.kind === "tasks" ? taskViewsFor() : viewsFor()),
);

// The view schema below does the real validation; this only keeps arrays and
// scalars out so the owner and ID can be set on an object.
const rawView = z.object({}).passthrough();

export const POST = route({ auth: "viewer", body: rawView, invalid: "invalid view" }, async ({ body: raw }) => {
  const id = typeof raw.id === "string" && raw.id ? raw.id : null;
  if (raw.kind === "tasks") {
    // A saved task view (item 12): the same table, its own strict schema.
    const parsed = taskViewSchema.safeParse({ ...raw, kind: "tasks", id: id ?? newViewId() });
    if (!parsed.success) {
      throw new HttpError(400, "invalid view", { issues: parsed.error.issues.slice(0, 5).map((i) => ({ path: i.path.map(String), message: i.message })) });
    }
    return submitTaskView(parsed.data);
  }
  // The ID is only honoured when it names a view that already exists (an
  // update). A new view gets a server-made ID. `kind` belongs to the row, not
  // to the issue view's definition.
  const { kind: _kind, ...definition } = raw;
  const parsed = viewSchema.safeParse({ ...definition, id: id ?? newViewId() });
  if (!parsed.success) {
    throw new HttpError(400, "invalid view", { issues: parsed.error.issues.slice(0, 5).map((i) => ({ path: i.path.map(String), message: i.message })) });
  }
  if (!parsed.data.name.trim()) throw new HttpError(400, "name required");
  return submitView(parsed.data);
});

export const DELETE = route(
  { auth: "viewer", query: z.object({ id: z.string().max(200).default(""), kind: z.enum(["issues", "tasks"]).default("issues") }) },
  async ({ query }) => {
    const ok = query.kind === "tasks" ? await deleteTaskView(query.id) : await deleteView(query.id);
    if (!ok) throw new HttpError(404, "not found");
    return { ok: true };
  },
);
