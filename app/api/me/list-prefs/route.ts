import { z } from "zod";
import { HttpError, route } from "@/lib/server/route";
import { clearListPrefs, readListPrefs, saveListPref } from "@/lib/settings";
import { LIST_PREFS_LIMIT, listKeySchema, listStateSchema } from "@/lib/views/list-prefs";

export const dynamic = "force-dynamic";

/**
 * The built-in lists' defaults (SPEC §4.2): the filters and display options
 * My issues, All issues, Backlog, Epics, a Release page and a dimension value
 * page open with. Local UI state, so it lives in `ui.lists` (ADR-001), not in
 * GitHub or in a saved view.
 */
export const GET = route({ auth: "viewer" }, async () => ({ lists: await readListPrefs() }));

const saveBody = z.object({ key: listKeySchema, state: listStateSchema }).strict();

export const PATCH = route({ auth: "viewer", body: saveBody, invalid: "invalid list state" }, async ({ body }) => {
  const current = await readListPrefs();
  if (!Object.hasOwn(current, body.key) && Object.keys(current).length >= LIST_PREFS_LIMIT) throw new HttpError(400, "too many list defaults");
  return { lists: await saveListPref(body.key, body.state) };
});

/** `?key=my` forgets one page's defaults; without a key, every page's. */
export const DELETE = route({ auth: "viewer", query: z.object({ key: listKeySchema.optional() }), invalid: "invalid list key" }, async ({ query }) => ({
  lists: await clearListPrefs(query.key),
}));
