import { idParams, route } from "@/lib/server/route";
import { labelPatchSchema } from "@/lib/tasks/model";
import { fail } from "@/lib/tasks/http";
import { deleteLabel, updateLabel } from "@/lib/tasks/service";

export const dynamic = "force-dynamic";

export const PATCH = route({ auth: "viewer", params: idParams, body: labelPatchSchema, invalid: "invalid task" }, async ({ owner, params, body }) => {
  const r = await updateLabel(owner, params.id, body);
  return r.ok ? r.value : fail(r);
});

export const DELETE = route({ auth: "viewer", params: idParams }, async ({ owner, params }) => {
  const r = await deleteLabel(owner, params.id);
  return r.ok ? { ok: true } : fail(r);
});
