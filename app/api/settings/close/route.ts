import { z } from "zod";
import { getStore } from "@/lib/store";
import { HttpError, route } from "@/lib/server/route";
import { readCloseDoneStatus, saveCloseDoneStatus } from "@/lib/settings";

export const dynamic = "force-dynamic";

/**
 * Settings → "Done Status for closing" (SPEC §4.8, W2): which Status option a
 * close sets. A project need not have an option called "Done", so the options
 * come from the mapped Status field by ID; closing is refused until one is chosen.
 */
export const GET = route({ auth: "viewer" }, async () => {
  const store = await getStore();
  const ref = store.projectFieldMap().status;
  const field = ref ? store.fields.get(ref.id) : undefined;
  const doneId = await readCloseDoneStatus();
  return {
    doneId: doneId && field?.options.some((o) => o.id === doneId) ? doneId : null,
    // The chosen option no longer exists: the UI asks for a new choice.
    missing: doneId !== null && !field?.options.some((o) => o.id === doneId),
    options: (field?.options ?? []).map((o) => ({ id: o.id, name: o.name, color: o.color })),
    statusFieldMissing: !field,
  };
});

export const POST = route(
  { auth: "viewer", body: z.object({ optionId: z.string().min(1).max(200).nullable() }).strict(), invalid: "invalid Done Status" },
  async ({ body }) => {
    if (body.optionId !== null) {
      const store = await getStore();
      const ref = store.projectFieldMap().status;
      const field = ref ? store.fields.get(ref.id) : undefined;
      if (!field?.options.some((o) => o.id === body.optionId)) throw new HttpError(400, "That is not a Status option of this project.");
    }
    await saveCloseDoneStatus(body.optionId);
    return { doneId: body.optionId };
  },
);
