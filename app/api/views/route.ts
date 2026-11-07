import { z } from "zod";
import { HttpError, route } from "@/lib/server/route";
import { deleteView, newViewId, submitView, viewsFor } from "@/lib/views/runtime";
import { viewSchema } from "@/lib/views/view";

export const dynamic = "force-dynamic";

// Saved views are Deska's only own data (SPEC §1); nothing here touches GitHub.

export const GET = route({ auth: "viewer" }, () => viewsFor());

// The view schema below does the real validation; this only keeps arrays and
// scalars out so the owner and ID can be set on an object.
const rawView = z.object({}).passthrough();

export const POST = route({ auth: "viewer", body: rawView, invalid: "invalid view" }, async ({ body: raw }) => {
  // The ID is only honoured when it names a view that already exists (an
  // update). A new view gets a server-made ID.
  const parsed = viewSchema.safeParse({ ...raw, id: typeof raw.id === "string" && raw.id ? raw.id : newViewId() });
  if (!parsed.success) {
    throw new HttpError(400, "invalid view", { issues: parsed.error.issues.slice(0, 5).map((i) => ({ path: i.path.map(String), message: i.message })) });
  }
  if (!parsed.data.name.trim()) throw new HttpError(400, "name required");
  return submitView(parsed.data);
});

export const DELETE = route({ auth: "viewer", query: z.object({ id: z.string().max(200).default("") }) }, async ({ query }) => {
  const ok = await deleteView(query.id);
  if (!ok) throw new HttpError(404, "not found");
  return { ok: true };
});
