import { NextResponse } from "next/server";
import { z } from "zod";
import { moveCard } from "@/lib/board/board";
import { submitEdit } from "@/lib/outbox/edit";
import { HttpError, route } from "@/lib/server/route";
import { invalidateReadCache } from "@/lib/store";
import { needsBulkConfirm } from "@/lib/outbox/queue";
import { buildViewRows } from "@/lib/views/rows";

// issueCount must be a real number: a numeric string used to slip past (or trip)
// the over-50 bulk guard (needsBulkConfirm compares with >).
const boardBody = z
  .object({
    issueCount: z.number().int().positive().optional(),
    card: z.string().min(1).max(200),
    target: z.string().max(200).nullable().optional(),
    boardField: z.enum(["status", "priority", "team", "platform"]).optional(),
    releaseId: z.string().max(200).nullable().optional(),
    idempotencyKey: z.string().min(8).max(100).optional(),
  })
  .strict();

/**
 * The board's move (drag a card to a column, or into a Release): a thin
 * wrapper around the generic edit (POST /api/issues/[number]/edit, W1).
 */
export const POST = route({ auth: "write", body: boardBody, invalid: "invalid board move" }, async ({ viewer, token, store, body }) => {
  if (needsBulkConfirm(body.issueCount ?? 1)) {
    return NextResponse.json({ error: "bulk edit over 50 needs confirmation", needsConfirm: true }, { status: 409 });
  }
  const row = buildViewRows(store, body.card)[0];
  if (!row) throw new HttpError(404, "issue not found in cache");
  const targetOptionId = body.target === "none" ? null : (body.target ?? null);
  const descriptor = moveCard(row, { columnOptionId: targetOptionId, boardField: body.boardField ?? "status" }, body.releaseId ?? null);
  if (!descriptor) return { queued: false, noop: true };
  const r = await submitEdit({
    viewer,
    token,
    store,
    issueNodeId: row.nodeId,
    body: { field: descriptor.field, next: descriptor.next, idempotencyKey: body.idempotencyKey },
  });
  if (r.status === 200) invalidateReadCache();
  return NextResponse.json({ queued: true, ...r.body }, { status: r.status });
});
