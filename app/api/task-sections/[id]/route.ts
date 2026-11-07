import { idParams, route } from "@/lib/server/route";
import { sectionPatchSchema } from "@/lib/tasks/model";
import { fail } from "@/lib/tasks/http";
import { deleteSection, updateSection } from "@/lib/tasks/service";

export const dynamic = "force-dynamic";

// Rename, reorder or collapse a section; deleting one keeps its tasks (they lose the section).
export const PATCH = route({ auth: "viewer", params: idParams, body: sectionPatchSchema, invalid: "invalid section" }, async ({ owner, params, body }) => {
  const r = await updateSection(owner, params.id, body);
  return r.ok ? r.value : fail(r);
});

export const DELETE = route({ auth: "viewer", params: idParams }, async ({ owner, params }) => {
  const r = await deleteSection(owner, params.id);
  return r.ok ? { ok: true } : fail(r);
});
