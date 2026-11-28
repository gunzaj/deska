import { z } from "zod";
import { lookupIssue } from "@/lib/server/lookup";
import { HttpError, route } from "@/lib/server/route";

export const dynamic = "force-dynamic";

/**
 * Bring an issue the cache doesn't hold into it, by number (one closed before
 * the import window). Reads from GitHub only; POST because it writes the cache.
 */
export const POST = route({ auth: "viewer", params: z.object({ number: z.string().max(20) }) }, async ({ params }) => {
  const number = Number(params.number);
  if (!Number.isInteger(number) || number <= 0) throw new HttpError(400, "bad issue number");
  return lookupIssue(number);
});
