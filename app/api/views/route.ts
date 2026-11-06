import { z } from "zod";
import { HttpError, route } from "@/lib/server/route";
import { deleteView, newViewId, submitView, viewsFor } from "@/lib/views/runtime";
import { viewSchema } from "@/lib/views/view";

export const dynamic = "force-dynamic";

// Saved views are Deska's only own data (SPEC §1); nothing here touches GitHub.

export const GET = route({ auth: "viewer" }, ({ viewer }) => viewsFor(viewer));

// The view schema below does the real validation; this only keeps arrays and
// scalars out so the owner and ID can be set on an object.
const rawView = z.object({}).passthrough();

export const POST = route({ auth: "viewer", body: rawView, invalid: "invalid view" }, async ({ viewer, body: raw }) => {
  // The owner is the signed-in user; the ID is only honoured when it names a
  // view that already exists (an update). A new view gets a server-made ID.
  const parsed = viewSchema.safeParse({ ...raw, id: typeof raw.id === "string" && raw.id ? raw.id : newViewId(), ownerId: viewer });
  if (!parsed.success) {
    throw new HttpError(400, "invalid view", { issues: parsed.error.issues.slice(0, 5).map((i) => ({ path: i.path.map(String), message: i.message })) });
  }
  if (!parsed.data.name.trim()) throw new HttpError(400, "name required");
  const saved = await submitView(viewer, parsed.data);
  if (!saved) throw new HttpError(403, "not allowed to edit this view");
  return saved;
});

export const DELETE = route({ auth: "viewer", query: z.object({ id: z.string().max(200).default("") }) }, async ({ viewer, query }) => {
  const ok = await deleteView(viewer, query.id);
  if (!ok) throw new HttpError(404, "not found or not allowed");
  return { ok: true };
});
