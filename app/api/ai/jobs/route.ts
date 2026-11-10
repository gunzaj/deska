import { z } from "zod";
import { jobsOfBatch } from "@/lib/ai/runner";
import { route } from "@/lib/server/route";

export const dynamic = "force-dynamic";

/**
 * Every job of one batch that is still in memory (SPEC §4.9): a batch's progress
 * and Cancel read this. The page keeps the states it has already seen, so a job
 * pruned from the runner's map does not disappear from a batch's count.
 */
export const GET = route(
  { auth: "public", query: z.object({ batch: z.string().uuid() }), invalid: "invalid batch id" },
  async ({ query }) => ({ jobs: jobsOfBatch(query.batch) }),
);
