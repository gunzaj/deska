import { z } from "zod";
import { cancelJob } from "@/lib/ai/runner";
import { HttpError, route } from "@/lib/server/route";

export const dynamic = "force-dynamic";

/** Cancel a queued or running AI job. */
export const POST = route({ auth: "public", params: z.object({ id: z.string().uuid() }), invalid: "invalid job id" }, async ({ params }) => {
  const job = cancelJob(params.id);
  if (!job) throw new HttpError(404, "No such AI job.");
  return { job };
});
