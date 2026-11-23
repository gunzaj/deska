import { dbDir } from "@/db";
import { frequentChoices, NO_FREQUENT } from "@/lib/server/frequent";
import { route } from "@/lib/server/route";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * The labels (by ID) and assignees (by lower-cased login) the user adds most
 * often, most used first, for the top of the pickers (SPEC §4.8). Read from
 * the local audit log; nothing here asks GitHub.
 */
export const GET = route({ auth: "viewer" }, async () => {
  if (!dbDir()) return NO_FREQUENT;
  const store = await getStore();
  const idByName = new Map([...store.labels].map(([id, l]) => [l.name.toLowerCase(), id]));
  return frequentChoices(idByName);
});
