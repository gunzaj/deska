import { NextResponse } from "next/server";
import { idParams, route } from "@/lib/server/route";
import { patchTaskSchema } from "@/lib/tasks/model";
import { assignable, fail, resolver, withHtml } from "@/lib/tasks/http";
import { deleteTask, getTask, updateTask } from "@/lib/tasks/service";

export const dynamic = "force-dynamic";

export const GET = route({ auth: "viewer", params: idParams }, async ({ viewer, params }) => {
  const r = await getTask(viewer, params.id);
  return r.ok ? NextResponse.json(withHtml(r.value)) : fail(r);
});

export const PATCH = route({ auth: "viewer", params: idParams, body: patchTaskSchema, invalid: "invalid task" }, async ({ viewer, params, body: patch }) => {
  // Look things up only when the patch needs them: a checkbox toggle needs neither (v5 3.8).
  const r = await updateTask(viewer, params.id, patch, patch.assignee !== undefined ? await assignable() : () => false, patch.links !== undefined ? await resolver() : undefined);
  return r.ok ? NextResponse.json(withHtml(r.value)) : fail(r);
});

export const DELETE = route({ auth: "viewer", params: idParams }, async ({ viewer, params }) => {
  const r = await deleteTask(viewer, params.id);
  return r.ok ? { ok: true } : fail(r);
});
