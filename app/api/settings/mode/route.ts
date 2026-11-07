import { z } from "zod";
import { route } from "@/lib/server/route";
import { readTasksOnly, saveTasksOnly } from "@/lib/settings";

export const dynamic = "force-dynamic";

/**
 * "Skip GitHub, use tasks only" (and back). Public like onboarding's other
 * routes: there is no local user yet when a first-run user skips. The desktop
 * guard and the origin check still apply. Local setting only; never touches GitHub.
 */
export const GET = route({ auth: "public" }, async () => ({ tasksOnly: await readTasksOnly() }));

export const POST = route({ auth: "public", body: z.object({ tasksOnly: z.boolean() }).strict(), invalid: "invalid mode" }, async ({ body }) => {
  await saveTasksOnly(body.tasksOnly);
  return { tasksOnly: body.tasksOnly };
});
