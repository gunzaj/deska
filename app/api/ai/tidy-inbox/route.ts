import { z } from "zod";
import { MAX_TIDY_TASKS, startTidyInbox, tidyInboxView } from "@/lib/ai/task-assist-service";
import { taskClockBody } from "@/lib/ai/task-clock";
import { HttpError, route, storeUnavailable } from "@/lib/server/route";

export const dynamic = "force-dynamic";

/**
 * The Inbox tasks and their stored suggestions (SPEC §4.9, AI2). Reads the
 * task store, the cache and `ai_results` only: nothing is sent to a model here.
 * A suggestion that was accepted is not offered again; a changed task marks its
 * suggestion outdated.
 */
export const GET = route({ auth: "viewer" }, async () => {
  return tidyInboxView().catch((e: unknown) => {
    throw storeUnavailable("/api/ai/tidy-inbox", e);
  });
});

const body = z
  .object({
    /** Rerun only these tasks ("Outdated · Run again"); every Inbox task otherwise. */
    taskIds: z.array(z.string().uuid()).min(1).max(MAX_TIDY_TASKS).optional(),
  })
  .merge(taskClockBody)
  .strict();

/**
 * One suggestion per Inbox task (SPEC §4.9 batch): one job each, sharing a
 * batch id, run one at a time. Above 20 tasks the page confirms first.
 */
export const POST = route({ auth: "viewer", body, invalid: "Those tasks are not valid." }, async ({ body }) => {
  const result = await startTidyInbox(body, body.taskIds).catch((e: unknown) => {
    throw storeUnavailable("/api/ai/tidy-inbox", e);
  });
  if (!result.batchId) throw new HttpError(400, "Those tasks are not in the Inbox any more.");
  return result;
});
