import { z } from "zod";
import { HttpError, route } from "@/lib/server/route";
import { restoreView } from "@/lib/views/runtime";

export const dynamic = "force-dynamic";

/** Undo a view delete (U1). Body: { id }. Only the owner, within 30 days. */
export const POST = route({ auth: "viewer", body: z.object({ id: z.string().min(1).max(200) }), invalid: "id required" }, async ({ viewer, body }) => {
  const view = await restoreView(viewer, body.id);
  if (!view) throw new HttpError(404, "not found or not allowed");
  return view;
});
