import { NextResponse } from "next/server";
import { z } from "zod";
import { idParams, route } from "@/lib/server/route";
import { fail, withHtml } from "@/lib/tasks/http";
import { snoozeTask } from "@/lib/tasks/service";

export const dynamic = "force-dynamic";

const body = z.object({ for: z.enum(["1h", "tomorrow"]) });

// "Snooze 1 h" and "Tomorrow" on a reminder notification (SPEC §4.6).
export const POST = route({ auth: "viewer", params: idParams, body, invalid: "invalid snooze" }, async ({ owner, params, body }) => {
  const r = await snoozeTask(owner, params.id, body.for);
  return r.ok ? NextResponse.json(withHtml(r.value)) : fail(r);
});
