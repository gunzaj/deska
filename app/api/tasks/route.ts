import { NextResponse } from "next/server";
import { route } from "@/lib/server/route";
import { createTaskSchema } from "@/lib/tasks/model";
import { fail, resolver, withHtml } from "@/lib/tasks/http";
import { createTask, listTasks } from "@/lib/tasks/service";

export const dynamic = "force-dynamic";

// Tasks are Deska-native (SPEC §12): nothing here touches GitHub.

export const GET = route({ auth: "viewer" }, ({ owner }) => listTasks(owner));

export const POST = route({ auth: "viewer", body: createTaskSchema, invalid: "invalid task" }, async ({ owner, body: input }) => {
  const r = await createTask(owner, input, input.links.length ? await resolver() : undefined);
  return r.ok ? NextResponse.json(withHtml(r.value), { status: 201 }) : fail(r);
});
