import { z } from "zod";
import { route } from "@/lib/server/route";
import { getStore } from "@/lib/store";
import { collectWatchChanges } from "@/lib/watch/changes";

export const dynamic = "force-dynamic";

// `kind` and `targetId` are checked against the viewer's own watchlist by
// `collectWatchChanges`; this only bounds the payload. Other keys (an old
// client's `nodeIds`) are ignored.
const body = z.object({ items: z.array(z.object({ kind: z.unknown(), targetId: z.unknown() })).max(200) });

/**
 * What changed on the viewer's watched items since they last looked (F6).
 * POST { items: [{ kind, targetId }] } → { changes: { "<kind>:<id>": FieldChange[] } }
 */
export const POST = route({ auth: "viewer", body, invalid: "items required" }, async ({ viewer, owner, body: { items } }) => {
  const store = await getStore().catch(() => null);
  return { changes: await collectWatchChanges(owner, items, (id) => store?.ghUsers.get(id)?.login ?? id, viewer) };
});
