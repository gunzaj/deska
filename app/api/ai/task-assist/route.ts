import { z } from "zod";
import { startTaskAssist } from "@/lib/ai/task-assist-service";
import { taskClockBody } from "@/lib/ai/task-clock";
import { route, storeUnavailable } from "@/lib/server/route";

export const dynamic = "force-dynamic";

const body = z
  .object({
    /** The typed quick-add line. */
    text: z.string().trim().min(1).max(500),
  })
  .merge(taskClockBody)
  .strict();

/**
 * Asks the model for a suggestion for one typed quick-add line (SPEC §4.9,
 * AI2). The line, the user's projects, sections and labels and the cached
 * issues sharing words with it go; nothing changes until the user accepts it.
 * Only when the user asks: the page calls this from its ✨ action.
 */
export const POST = route({ auth: "viewer", body, invalid: "That task line is not valid." }, async ({ body }) => {
  const job = await startTaskAssist(body.text, body).catch((e: unknown) => {
    throw storeUnavailable("/api/ai/task-assist", e);
  });
  return { job };
});
