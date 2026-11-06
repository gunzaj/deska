import { NextResponse } from "next/server";
import { idParams, route } from "@/lib/server/route";
import { commentSchema } from "@/lib/tasks/model";
import { fail, withBodyHtml } from "@/lib/tasks/http";
import { addComment, listComments } from "@/lib/tasks/service";

export const dynamic = "force-dynamic";

// Task comments (SPEC §12.7): readable and writable by whoever can see the task.
export const GET = route({ auth: "viewer", params: idParams }, async ({ viewer, params }) => {
  const r = await listComments(viewer, params.id);
  return r.ok ? r.value.map(withBodyHtml) : fail(r);
});

export const POST = route({ auth: "viewer", params: idParams, body: commentSchema, invalid: "invalid task" }, async ({ viewer, params, body }) => {
  const r = await addComment(viewer, params.id, body.body);
  return r.ok ? NextResponse.json(withBodyHtml(r.value), { status: 201 }) : fail(r);
});
