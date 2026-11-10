import { NextResponse } from "next/server";
import { idParams, route } from "@/lib/server/route";
import { fail, withHtml } from "@/lib/tasks/http";
import { restoreTask } from "@/lib/tasks/service";

export const dynamic = "force-dynamic";

/** Undo a task delete (U1). Only the creator, within the retention window. */
export const POST = route({ auth: "viewer", params: idParams }, async ({ owner, params }) => {
  const r = await restoreTask(owner, params.id);
  return r.ok ? NextResponse.json(await withHtml(r.value)) : await fail(r);
});
