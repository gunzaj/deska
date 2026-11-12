import { NextResponse } from "next/server";
import { z } from "zod";
import { route } from "@/lib/server/route";
import { createTaskSchema } from "@/lib/tasks/model";
import { fail, resolver } from "@/lib/tasks/http";
import { batchIds, batchInFlight, beginBatch, rememberBatch } from "@/lib/tasks/batches";
import { createTasks, getTask } from "@/lib/tasks/service";

export const dynamic = "force-dynamic";

const batchBody = z
  .object({
    /** One key per Ramble review: a retry finds the first request's tasks. */
    idempotencyKey: z.string().trim().min(1).max(100),
    tasks: z.array(createTaskSchema).min(1).max(12),
  })
  .strict();

/**
 * Ramble's one batch create (item 13): every task or none, in one
 * transaction, and a retry with the same key makes no duplicates.
 */
export const POST = route({ auth: "viewer", body: batchBody, invalid: "invalid tasks" }, async ({ owner, body }) => {
  const seen = batchIds(body.idempotencyKey);
  if (seen) {
    const found = await Promise.all(seen.map((id) => getTask(owner, id)));
    return { tasks: found.flatMap((r) => (r.ok ? [r.value] : [])) };
  }
  // The first request's answer may be lost while it is still committing: a
  // retry with the same key waits for it instead of creating a second batch.
  const inflight = batchInFlight(body.idempotencyKey);
  if (inflight) {
    const r = await inflight;
    if (!r.ok) return await fail(r);
    return NextResponse.json({ tasks: r.value }, { status: 201 });
  }
  // Registered before the resolver is awaited: it may wait for the store on the
  // first request, and a retry that arrives meanwhile must wait for this batch.
  const p = (async () => {
    const r = await createTasks(owner, body.tasks, body.tasks.some((t) => t.links.length) ? await resolver() : undefined);
    if (r.ok) rememberBatch(body.idempotencyKey, r.value.map((t) => t.id));
    return r;
  })();
  beginBatch(body.idempotencyKey, p);
  const r = await p;
  if (!r.ok) return await fail(r);
  return NextResponse.json({ tasks: r.value }, { status: 201 });
});
