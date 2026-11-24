import { NextResponse } from "next/server";
import { z } from "zod";
import { commentSchema, submitComment } from "@/lib/outbox/comment";
import { HttpError, route } from "@/lib/server/route";
import { invalidateReadCache } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * Post a comment on an issue (SPEC §4.8). The comment goes through the durable
 * outbox and is sent right away: 201 posted, 202 pending (retry scheduled),
 * 502 failed, 403 when the write gate is off.
 */
export const POST = route(
  { auth: "write", params: z.object({ number: z.string().max(20) }), body: commentSchema, invalid: "invalid comment" },
  async ({ viewer, token, store, params, body }) => {
    const issue = store.issueByNumber(Number(params.number));
    if (!issue) throw new HttpError(404, "issue not found in cache");
    const r = await submitComment({ viewer, token, store, issueNodeId: issue.nodeId, body });
    // The issue was re-read into the cache (its "updated" time moved).
    if (r.status === 201) invalidateReadCache();
    return NextResponse.json(r.body, { status: r.status });
  },
);
