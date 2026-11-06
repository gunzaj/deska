import { z } from "zod";
import { isIsoDate } from "@/lib/tasks/dates";
import { route } from "@/lib/server/route";
import { clearSnooze, listSnoozes, setSnooze } from "@/lib/triage/snoozes";

export const dynamic = "force-dynamic";

// The viewer's own triage snoozes (F3). Nobody else's are ever readable or
// writable here: every call acts on the signed-in login. Not a GitHub write,
// so it works with WRITE_MODE=off.

const nodeId = z.string().min(1).max(200);
const until = z.string().refine(isIsoDate, "until must be YYYY-MM-DD");

export const GET = route({ auth: "viewer" }, async ({ viewer }) => ({ snoozes: await listSnoozes(viewer) }));

export const PUT = route({ auth: "viewer", body: z.object({ nodeId, until }), invalid: "nodeId required and until must be YYYY-MM-DD" }, async ({ viewer, body }) => {
  await setSnooze(viewer, body.nodeId, body.until);
  return { nodeId: body.nodeId, until: body.until };
});

export const DELETE = route({ auth: "viewer", query: z.object({ nodeId }), invalid: "nodeId required" }, async ({ viewer, query }) => {
  await clearSnooze(viewer, query.nodeId);
  return { ok: true };
});
