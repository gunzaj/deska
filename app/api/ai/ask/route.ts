import { z } from "zod";
import { MAX_ASK_QUESTION, MAX_ASK_ROWS } from "@/lib/ai/ask";
import { latestListAnswer, startListAsk } from "@/lib/ai/ask-service";
import { HttpError, route, storeUnavailable } from "@/lib/server/route";

export const dynamic = "force-dynamic";

const numbers = z
  .string()
  .min(1)
  .max(2_500)
  .regex(/^\d+(,\d+)*$/, "Those issue numbers are not valid.")
  .transform((s) => s.split(",").map(Number))
  .refine((ns) => ns.length <= MAX_ASK_ROWS && ns.every((n) => Number.isInteger(n) && n > 0), "Those issue numbers are not valid.");

const query = z.object({
  numbers,
  /** The list's full size; the sent rows are the first `MAX_ASK_ROWS`. */
  total: z.string().regex(/^\d{1,9}$/).transform(Number).optional(),
});

const body = z
  .object({
    question: z.string().trim().min(1).max(MAX_ASK_QUESTION),
    numbers: z.array(z.number().int().positive()).min(1).max(MAX_ASK_ROWS),
    total: z.number().int().positive().optional(),
  })
  .strict();

/**
 * The list's latest answer and whether AI may run (SPEC §4.9, AI4). The list is
 * the issue numbers in display order; the answer is kept per list. Reads the cache
 * and `ai_results` only: nothing is sent to a model here.
 */
export const GET = route({ auth: "viewer", query, invalid: "Those issue numbers are not valid." }, async ({ query }) => {
  return latestListAnswer(query.numbers, query.total ?? query.numbers.length).catch((e: unknown) => {
    throw storeUnavailable("/api/ai/ask", e);
  });
});

/** Asks the model a question about this list; runs only when the user asks (SPEC §4.9). */
export const POST = route({ auth: "viewer", body, invalid: "That question is not valid." }, async ({ body }) => {
  const job = await startListAsk(body.numbers, body.question, body.total ?? body.numbers.length).catch((e: unknown) => {
    throw storeUnavailable("/api/ai/ask", e);
  });
  if (!job) throw new HttpError(400, "There is nothing to ask about.");
  return { job };
});
