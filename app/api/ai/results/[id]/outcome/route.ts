import { z } from "zod";
import { acceptTriageSuggestion, SUGGESTION_PARTS, type SuggestionPart } from "@/lib/ai/accept";
import { markResult, resultById } from "@/lib/ai/results";
import { HttpError, route } from "@/lib/server/route";
import { writeGate, WRITE_MESSAGES } from "@/lib/writes/gate";

export const dynamic = "force-dynamic";

/**
 * Accept or dismiss a stored suggestion (SPEC §4.9). Dismiss is local.
 * Accepting a GitHub change goes through the write gate and the §4.8 outbox
 * like a manual edit (W1), and only the parts the user chose (`parts`); with
 * writes off it is refused with the reason. Accepting a task change is a normal
 * local edit with Undo: the page applied it, and marking the result accepted
 * records that (AI2).
 */
export const POST = route(
  {
    auth: "viewer",
    params: z.object({ id: z.string().uuid() }),
    body: z
      .object({
        outcome: z.enum(["accepted", "dismissed"]),
        /** Which suggested parts to apply; absent = all of them. */
        parts: z.array(z.enum(SUGGESTION_PARTS as [string, ...string[]])).min(1).optional(),
      })
      .strict(),
    invalid: "invalid outcome",
  },
  async ({ params, body }) => {
    const row = await resultById(params.id);
    if (!row) throw new HttpError(404, "No such AI result.");
    if (body.outcome === "dismissed") {
      await markResult(params.id, "dismissed");
      return { outcome: "dismissed" };
    }
    // A task suggestion is a local edit: the page applies it and marks the
    // result accepted; only a GitHub change goes through the write gate.
    if (row.subjectKind !== "issue") {
      await markResult(params.id, "accepted");
      return { outcome: "accepted" };
    }
    const gate = await writeGate();
    if (!gate.allowed) throw new HttpError(409, gate.reason ?? WRITE_MESSAGES.settingOff);
    const applied = await acceptTriageSuggestion(row, { parts: body.parts as SuggestionPart[] | undefined });
    await markResult(params.id, "accepted");
    return { outcome: "accepted", ...applied };
  },
);
