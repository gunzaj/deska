import { z } from "zod";
import { latestTriageSuggestion, startIssueTriage } from "@/lib/ai/triage-service";
import { HttpError, route, storeUnavailable } from "@/lib/server/route";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const params = z.object({ number: z.string().regex(/^[1-9]\d{0,9}$/) });

/**
 * The issue's latest triage suggestion and whether AI may run (SPEC §4.9, AI1).
 * Reads the cache and `ai_results` only: nothing is sent to a model here.
 */
export const GET = route({ auth: "viewer", params, invalid: "bad issue number" }, async ({ params }) => {
  const view = await latestTriageSuggestion(Number(params.number)).catch((e: unknown) => {
    throw storeUnavailable("/api/issues/[number]/ai", e);
  });
  if (!view) throw new HttpError(404, "not found");
  return NextResponse.json(view);
});

/** Asks the model for a suggestion for this issue; runs only when the user asks (SPEC §4.9). */
export const POST = route({ auth: "viewer", params, invalid: "bad issue number" }, async ({ params }) => {
  const job = await startIssueTriage(Number(params.number)).catch((e: unknown) => {
    throw storeUnavailable("/api/issues/[number]/ai", e);
  });
  if (!job) throw new HttpError(404, "not found");
  return NextResponse.json({ job });
});
