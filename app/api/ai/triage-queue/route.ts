import { z } from "zod";
import { startQueueTriage } from "@/lib/ai/triage-service";
import { HttpError, route, storeUnavailable } from "@/lib/server/route";

export const dynamic = "force-dynamic";

/**
 * One suggestion per issue of a queue (SPEC §4.9, AI1). A batch shares one id;
 * the runner runs its jobs one at a time. All numbers are checked before the
 * first job starts, so a queue that changed starts nothing.
 */
export const POST = route(
  {
    auth: "viewer",
    body: z.object({ numbers: z.array(z.number().int().positive()).min(1).max(200) }).strict(),
    invalid: "Those issue numbers are not valid.",
  },
  async ({ body }) => {
    const batch = await startQueueTriage(body.numbers).catch((e: unknown) => {
      throw storeUnavailable("/api/ai/triage-queue", e);
    });
    if (batch.missing.length) throw new HttpError(400, `Not in the Deska cache: ${batch.missing.map((n) => `#${n}`).join(", ")}`);
    return { batchId: batch.batchId, jobs: batch.jobs };
  },
);
