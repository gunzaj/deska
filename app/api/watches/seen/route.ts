import { z } from "zod";
import { route } from "@/lib/server/route";
import { markSeen } from "@/lib/watch/repo";

export const dynamic = "force-dynamic";

const body = z.object({ kind: z.enum(["issue", "view"]), targetId: z.string().min(1).max(200) });

/** The owner looked at a watched item: what changed before now is no longer news (F6). */
export const POST = route({ auth: "viewer", body, invalid: "kind and targetId required" }, async ({ owner, body }) => ({
  // Not watched: nothing to mark, and nothing to report.
  watch: await markSeen(owner, body.kind, body.targetId),
}));
