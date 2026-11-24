import { z } from "zod";
import { detailResponse } from "@/lib/server/detail-route";
import { route } from "@/lib/server/route";

export const dynamic = "force-dynamic";

/**
 * Body + comments for the issue panel (read-only GETs). `?fresh=1` asks GitHub
 * again instead of the one-minute cache: a video's signed URL has expired.
 */
export const GET = route(
  { auth: "viewer", params: z.object({ number: z.string().max(20) }), query: z.object({ fresh: z.string().max(5).optional() }) },
  ({ params, query }) => detailResponse(params.number, query.fresh === "1"),
);
