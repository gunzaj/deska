import { z } from "zod";
import { MAX_ASK_QUESTION } from "@/lib/ai/ask";
import { latestIssueAnswer, startIssueAsk } from "@/lib/ai/ask-service";
import { HttpError, route, storeUnavailable } from "@/lib/server/route";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const params = z.object({ number: z.string().regex(/^[1-9]\d{0,9}$/) });

/**
 * The issue's latest answer and whether AI may run (SPEC §4.9, AI4). Reads the
 * cache and `ai_results` only: nothing is sent to a model here.
 */
export const GET = route({ auth: "viewer", params, invalid: "bad issue number" }, async ({ params }) => {
  const view = await latestIssueAnswer(Number(params.number)).catch((e: unknown) => {
    throw storeUnavailable("/api/issues/[number]/ask", e);
  });
  if (!view) throw new HttpError(404, "not found");
  return NextResponse.json(view);
});

/** Asks the model a question about this issue; runs only when the user asks (SPEC §4.9). */
export const POST = route(
  { auth: "viewer", params, body: z.object({ question: z.string().trim().min(1).max(MAX_ASK_QUESTION) }).strict(), invalid: "That question is not valid." },
  async ({ params, body }) => {
    const job = await startIssueAsk(Number(params.number), body.question).catch((e: unknown) => {
      throw storeUnavailable("/api/issues/[number]/ask", e);
    });
    if (!job) throw new HttpError(404, "not found");
    return NextResponse.json({ job });
  },
);
