import { NextResponse } from "next/server";
import { createIssueSchema, submitCreate } from "@/lib/outbox/create";
import { route } from "@/lib/server/route";
import { invalidateReadCache } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * Create an issue (SPEC §4.8, W3): one outbox job that creates it on GitHub,
 * adds it to the pinned project, sets the mapped fields and the Type. The form's
 * fields are validated against the discovered metadata by ID. 201 = created and
 * re-read; 202 = queued for a retry (the list shows a pending row); 409 =
 * conflict; 502 = failed; 403 = the write gate is off.
 */
export const POST = route({ auth: "write", body: createIssueSchema, invalid: "invalid issue" }, async ({ viewer, token, store, body }) => {
  const r = await submitCreate({ viewer, token, store, body });
  // The create job re-read the issue into the cache: this instance's read model is older.
  if (r.status === 201) invalidateReadCache();
  return NextResponse.json(r.body, { status: r.status });
});
