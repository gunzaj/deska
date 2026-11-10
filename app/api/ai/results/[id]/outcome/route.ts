import { z } from "zod";
import { markResult, resultById } from "@/lib/ai/results";
import { writeEnabled } from "@/lib/outbox/queue";
import { EDITING_OFF } from "@/lib/client/edit";
import { localToken } from "@/lib/github/local-token";
import { MESSAGES } from "@/lib/github/token-states";
import { HttpError, route } from "@/lib/server/route";

export const dynamic = "force-dynamic";

/** Why a GitHub change can't be accepted now (SPEC §3.4, §4.9). */
function writeOffReason(): string {
  return localToken() !== null ? MESSAGES.readOnly : EDITING_OFF;
}

/**
 * Accept or dismiss a stored suggestion (SPEC §4.9). Dismiss is local.
 * Accepting a GitHub change goes through the write gate and the write
 * milestones like a manual edit: while writes are off it is refused with the
 * reason, and this build has no write path yet (W1). Accepting a task change is
 * a normal local edit with Undo: the page applied it, and marking the result
 * accepted records that (AI2).
 */
export const POST = route(
  {
    auth: "viewer",
    params: z.object({ id: z.string().uuid() }),
    body: z.object({ outcome: z.enum(["accepted", "dismissed"]) }).strict(),
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
    if (!writeEnabled()) throw new HttpError(409, writeOffReason());
    // Applying a suggestion is W1's outbox, not built yet: never claim it applied.
    throw new HttpError(501, "Accepting a GitHub change arrives with the write milestones (W1).");
  },
);
