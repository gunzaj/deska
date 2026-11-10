import { NextResponse } from "next/server";
import { idParams, route } from "@/lib/server/route";
import { commentSchema } from "@/lib/tasks/model";
import { fail, withBodyHtml } from "@/lib/tasks/http";
import { addComment, listComments } from "@/lib/tasks/service";

export const dynamic = "force-dynamic";

// Task comments (SPEC §12.7): readable and writable by whoever can see the task.
export const GET = route({ auth: "viewer", params: idParams }, async ({ owner, params }) => {
  const r = await listComments(owner, params.id);
  return r.ok ? await Promise.all(r.value.map(withBodyHtml)) : await fail(r);
});

export const POST = route({ auth: "viewer", params: idParams, body: commentSchema, invalid: "invalid task" }, async ({ owner, params, body }) => {
  const r = await addComment(owner, params.id, body.body);
  return r.ok ? NextResponse.json(await withBodyHtml(r.value), { status: 201 }) : await fail(r);
});
