import { z } from "zod";
import { dbDir } from "@/db";
import { listOpenEdits } from "@/lib/outbox/store";
import { route } from "@/lib/server/route";

export const dynamic = "force-dynamic";

/**
 * The viewer's edits that aren't done (pending, failed, conflict), so the UI
 * can show them again after a reload (W1). `?mine=1` is the only scope.
 */
export const GET = route({ auth: "viewer", query: z.object({ mine: z.literal("1") }), invalid: "only ?mine=1 is supported" }, async () => {
  if (!dbDir()) return { entries: [] };
  return { entries: await listOpenEdits() };
});
