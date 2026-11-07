import { z } from "zod";
import { detailResponse } from "@/lib/server/detail-route";
import { route } from "@/lib/server/route";

export const dynamic = "force-dynamic";

/** Body + comments for the issue panel (read-only GETs). */
export const GET = route({ auth: "viewer", params: z.object({ number: z.string().max(20) }) }, ({ params }) => detailResponse(params.number));
