import { z } from "zod";
import { duplicatesOf } from "@/lib/server/duplicates";
import { HttpError, route, storeUnavailable } from "@/lib/server/route";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Possible duplicates of an issue (F7): up to 3 links, read-only. */
export const GET = route(
  { auth: "viewer", params: z.object({ number: z.string().regex(/^[1-9]\d{0,9}$/) }), invalid: "bad issue number" },
  async ({ params }) => {
    const duplicates = await duplicatesOf(Number(params.number)).catch((e: unknown) => {
      throw storeUnavailable("/api/issues/[number]/duplicates", e);
    });
    if (!duplicates) throw new HttpError(404, "not found");
    return NextResponse.json({ duplicates }, { headers: { "cache-control": "private, max-age=60" } });
  },
);
