import { NextResponse } from "next/server";
import { idParams, route } from "@/lib/server/route";
import { patchTaskSchema } from "@/lib/tasks/model";
import { fail, resolver, withHtml } from "@/lib/tasks/http";
import { deleteTask, getTask, updateTask } from "@/lib/tasks/service";

export const dynamic = "force-dynamic";

export const GET = route({ auth: "viewer", params: idParams }, async ({ owner, params }) => {
  const r = await getTask(owner, params.id);
  return r.ok ? NextResponse.json(await withHtml(r.value)) : await fail(r);
});

export const PATCH = route({ auth: "viewer", params: idParams, body: patchTaskSchema, invalid: "invalid task" }, async ({ owner, params, body: patch }) => {
  // Look things up only when the patch needs them: a checkbox toggle needs neither (v5 3.8).
  const r = await updateTask(owner, params.id, patch, patch.links !== undefined ? await resolver() : undefined);
  return r.ok ? NextResponse.json(await withHtml(r.value)) : await fail(r);
});

export const DELETE = route({ auth: "viewer", params: idParams }, async ({ owner, params }) => {
  const r = await deleteTask(owner, params.id);
  return r.ok ? { ok: true } : await fail(r);
});
