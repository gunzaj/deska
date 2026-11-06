import { NextResponse } from "next/server";
import { z } from "zod";
import { editSchema, submitEdit } from "@/lib/outbox/edit";
import { HttpError, route } from "@/lib/server/route";
import { invalidateReadCache } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * Edit one field of an issue (W1): Status, Priority, Team, Platform, Release,
 * Type, milestone, labels/assignees (as { added, removed } deltas) or state.
 * The edit goes through the durable outbox and is processed right away:
 * 200 done, 202 pending (retry scheduled), 409 conflict (with GitHub's value),
 * 502 failed, 422 when closing isn't configured.
 */
export const POST = route(
  { auth: "write", params: z.object({ number: z.string().max(20) }), body: editSchema, invalid: "invalid edit" },
  async ({ viewer, token, store, params, body }) => {
    const issue = store.issueByNumber(Number(params.number));
    if (!issue) throw new HttpError(404, "issue not found in cache");
    const r = await submitEdit({ viewer, token, store, issueNodeId: issue.nodeId, body });
    // The write re-read the issue into Postgres; this instance shouldn't serve
    // its older read model for the next few seconds.
    if (r.status === 200) invalidateReadCache();
    return NextResponse.json(r.body, { status: r.status });
  },
);
