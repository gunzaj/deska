import { NextResponse } from "next/server";
import { route } from "@/lib/server/route";
import { labelInputSchema } from "@/lib/tasks/model";
import { fail } from "@/lib/tasks/http";
import { createLabel } from "@/lib/tasks/service";

export const dynamic = "force-dynamic";

// Personal task labels (SPEC §12.3). Listing comes with GET /api/tasks.
export const POST = route({ auth: "viewer", body: labelInputSchema, invalid: "invalid task" }, async ({ owner, body }) => {
  const r = await createLabel(owner, body);
  return r.ok ? NextResponse.json(r.value, { status: 201 }) : fail(r);
});
