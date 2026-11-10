import { z } from "zod";
import { route } from "@/lib/server/route";
import { commentSchema } from "@/lib/tasks/model";
import { fail, withBodyHtml } from "@/lib/tasks/http";
import { editComment, removeComment } from "@/lib/tasks/service";

export const dynamic = "force-dynamic";

const params = z.object({ id: z.string().min(1).max(200), cid: z.string().min(1).max(200) });

// Authors edit and delete their own comments only.
export const PATCH = route({ auth: "viewer", params, body: commentSchema, invalid: "invalid task" }, async ({ owner, params: p, body }) => {
  const r = await editComment(owner, p.id, p.cid, body.body);
  return r.ok ? await withBodyHtml(r.value) : await fail(r);
});

export const DELETE = route({ auth: "viewer", params }, async ({ owner, params: p }) => {
  const r = await removeComment(owner, p.id, p.cid);
  return r.ok ? { ok: true } : await fail(r);
});
