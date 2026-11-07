import { NextResponse } from "next/server";
import { route } from "@/lib/server/route";
import { projectInputSchema } from "@/lib/tasks/model";
import { fail } from "@/lib/tasks/http";
import { createProject } from "@/lib/tasks/service";

export const dynamic = "force-dynamic";

// Personal task projects (SPEC §12.3). Listing comes with GET /api/tasks.
export const POST = route({ auth: "viewer", body: projectInputSchema, invalid: "invalid task" }, async ({ owner, body }) => {
  const r = await createProject(owner, body);
  return r.ok ? NextResponse.json(r.value, { status: 201 }) : fail(r);
});
