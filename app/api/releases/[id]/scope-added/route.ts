import { z } from "zod";
import { idParams, route } from "@/lib/server/route";
import { listFieldChanges } from "@/lib/server/changes";
import { isIsoDate } from "@/lib/tasks/dates";

export const dynamic = "force-dynamic";

const query = z.object({ since: z.string().refine(isIsoDate, "since must be YYYY-MM-DD") });

/**
 * Issues whose Release was set to this one on or after `since` (F2: scope added
 * after the Release started). The client keeps those still in the Release.
 * GET /api/releases/<iteration id>/scope-added?since=YYYY-MM-DD
 */
export const GET = route({ auth: "viewer", params: idParams, query, invalid: "since must be YYYY-MM-DD" }, async ({ params, query: { since } }) => {
  const changes = await listFieldChanges({ since: new Date(`${since}T00:00:00Z`), fields: ["release"], newValue: params.id });
  return { since, nodeIds: [...new Set(changes.map((c) => c.issueNodeId))] };
});
