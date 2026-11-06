import { z } from "zod";
import { route } from "@/lib/server/route";
import { clearDigestCheck } from "@/lib/watch/digest";
import { addWatch, listWatches, removeWatch } from "@/lib/watch/repo";

export const dynamic = "force-dynamic";

// The viewer's own watchlist (F6). Every call acts on the signed-in login;
// not a GitHub write, so it works with WRITE_MODE=off.

const target = z.object({ kind: z.enum(["issue", "view"]), targetId: z.string().min(1).max(200) });

export const GET = route({ auth: "viewer" }, async ({ viewer }) => ({ watches: await listWatches(viewer) }));

export const PUT = route({ auth: "viewer", body: target, invalid: "kind must be issue or view, and targetId is required" }, async ({ viewer, body }) => {
  const watch = await addWatch(viewer, body.kind, body.targetId);
  clearDigestCheck(viewer);
  return { watch };
});

export const DELETE = route({ auth: "viewer", query: target, invalid: "kind must be issue or view, and targetId is required" }, async ({ viewer, query }) => {
  await removeWatch(viewer, query.kind, query.targetId);
  clearDigestCheck(viewer);
  return { ok: true };
});
