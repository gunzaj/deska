import { z } from "zod";
import { route } from "@/lib/server/route";
import { markNotificationsRead } from "@/lib/tasks/service";

export const dynamic = "force-dynamic";

const body = z.union([z.object({ all: z.literal(true) }), z.object({ ids: z.array(z.string().max(64)).max(200) })]);

export const POST = route({ auth: "viewer", body, invalid: "invalid task" }, async ({ viewer, body }) => {
  await markNotificationsRead(viewer, "all" in body ? "all" : body.ids);
  return { ok: true };
});
