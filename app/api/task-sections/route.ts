import { NextResponse } from "next/server";
import { route } from "@/lib/server/route";
import { sectionInputSchema } from "@/lib/tasks/model";
import { fail } from "@/lib/tasks/http";
import { createSection } from "@/lib/tasks/service";

export const dynamic = "force-dynamic";

// Sections of a task project (SPEC §4.6, D13). Listing comes with GET /api/tasks.
export const POST = route({ auth: "viewer", body: sectionInputSchema, invalid: "invalid section" }, async ({ owner, body }) => {
  const r = await createSection(owner, body);
  return r.ok ? NextResponse.json(r.value, { status: 201 }) : fail(r);
});
