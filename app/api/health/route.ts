import { NextResponse } from "next/server";
import { healthMaxSyncAgeSec, healthOf } from "@/lib/sync/health";
import { writeEnabled } from "@/lib/outbox/queue";
import { doneStatusOption } from "@/lib/outbox/runtime";
import { getStore } from "@/lib/store";
import { getSyncKv } from "@/lib/sync/runtime";

export const dynamic = "force-dynamic";

/**
 * Uptime check (IMPROVEMENTS S3), public: 200 while the last successful sync
 * is younger than HEALTH_MAX_SYNC_AGE_SEC (default 1800), 503 when it is older,
 * has never happened, or the database can't be read. The body carries nothing
 * beyond that status.
 */
export async function GET() {
  const headers = { "cache-control": "no-store" };
  try {
    // Re-reads sync_state, so this is also the database check.
    const kv = await getSyncKv();
    const { ok, lastSyncAgeSec } = healthOf(kv, Date.now(), healthMaxSyncAgeSec());
    // With writes on, whether closing an issue can set the agreed Status (W1).
    // It doesn't make the deployment unhealthy: only Close is unavailable.
    const writes = writeEnabled() ? { doneStatusOk: doneStatusOption(await getStore()).ok } : undefined;
    return NextResponse.json({ ok, lastSyncAgeSec, ...(writes ? { writes } : {}) }, { status: ok ? 200 : 503, headers });
  } catch {
    return NextResponse.json({ ok: false, lastSyncAgeSec: null }, { status: 503, headers });
  }
}
