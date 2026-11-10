import { z } from "zod";
import { getJob } from "@/lib/ai/runner";
import { HttpError, route } from "@/lib/server/route";

export const dynamic = "force-dynamic";

/** A job's state, polled by the page (SPEC §4.9). */
export const GET = route({ auth: "public", params: z.object({ id: z.string().uuid() }), invalid: "invalid job id" }, async ({ params }) => {
  const job = getJob(params.id);
  if (!job) throw new HttpError(404, "No such AI job.");
  return { job };
});
