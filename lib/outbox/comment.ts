// Posting a comment (SPEC §4.8): one outbox job per comment, behind the same
// gate and outbox as every other write. Comments on one issue are sent in the
// order they were written.
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { ReadModel } from "@/lib/sync/read-model";
import { depsFor } from "./runtime";
import { enqueueEdit, processEdit, type OutboxRow, type ProcessDeps } from "./store";

/** GitHub's own limit on a comment body. */
export const COMMENT_MAX = 65_536;

export const commentSchema = z
  .object({
    body: z.string().max(COMMENT_MAX),
    /** Per user action; a retried request with the same key is the same comment. */
    idempotencyKey: z.string().min(8).max(100).optional(),
  })
  .strict();
export type CommentBody = z.infer<typeof commentSchema>;

export type CommentResult = { status: number; body: { entry?: OutboxRow; error?: string } };

/**
 * Store the comment as an outbox job and send it now. 201 = posted (the entry's
 * `result` holds the comment's ID and link); 202 = queued for a retry; 502 = failed.
 */
export async function submitComment(args: {
  viewer: string;
  token: string;
  store: ReadModel;
  issueNodeId: string;
  body: CommentBody;
  /** Tests inject a fake GitHub. */
  deps?: () => ProcessDeps;
}): Promise<CommentResult> {
  const text = args.body.body.trim();
  if (!text) return { status: 400, body: { error: "a comment needs some text" } };
  const entry = await enqueueEdit({
    userId: args.viewer.toLowerCase(),
    issueNodeId: args.issueNodeId,
    op: "comment",
    // One field for all of an issue's comments, so they are sent in order.
    field: "comment",
    base: null,
    next: { body: text },
    // Namespaced per user: one user's key can never return another's comment.
    idempotencyKey: `${args.viewer.toLowerCase()}:${args.body.idempotencyKey ?? randomUUID()}`,
  });
  const deps = args.deps ? args.deps() : await depsFor(args.token, "", args.store.projectFieldMap());
  const after = (await processEdit(entry.id, deps)) ?? entry;
  const code = after.status === "done" ? 201 : after.status === "failed" || after.status === "conflict" ? 502 : 202;
  return { status: code, body: { entry: after } };
}
