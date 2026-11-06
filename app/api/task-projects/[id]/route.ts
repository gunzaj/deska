import { idParams, route } from "@/lib/server/route";
import { projectPatchSchema } from "@/lib/tasks/model";
import { fail } from "@/lib/tasks/http";
import { updateProject } from "@/lib/tasks/service";

export const dynamic = "force-dynamic";

// Rename, recolour, reorder or archive (no delete: archiving keeps the tasks).
export const PATCH = route({ auth: "viewer", params: idParams, body: projectPatchSchema, invalid: "invalid task" }, async ({ viewer, params, body }) => {
  const r = await updateProject(viewer, params.id, body);
  return r.ok ? r.value : fail(r);
});
