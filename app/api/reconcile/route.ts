import { NextResponse } from "next/server";
import { z } from "zod";
import { route } from "@/lib/server/route";
import { dbDir } from "@/db";
import { redactError } from "@/lib/sync/health";
import { githubReconcileSource } from "@/lib/sync/live";
import { runNightly } from "@/lib/sync/nightly";
import { currentFieldMap, withLockedSyncKv } from "@/lib/sync/runtime";

import { PostgresStore } from "@/lib/sync/store-postgres";
import { invalidateReadCache } from "@/lib/store";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * Daily Vercel cron (CRON_SECRET, like GET /api/sync-now): the nightly
 * reconcile (IMPROVEMENTS S6). Runs only when due (20 h since the last full
 * run), so the worker and the cron don't both do it; `?force=1` overrides.
 */
export const GET = route({ auth: "cron", query: z.object({ force: z.string().optional() }) }, async ({ query }) => {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return NextResponse.json({ error: "GITHUB_TOKEN not configured" }, { status: 503 });
  if (!dbDir()) return NextResponse.json({ error: "DESKA_DB_DIR not configured — nothing to reconcile" }, { status: 503 });
  const force = query.force === "1";
  const store = new PostgresStore();
  try {
    const fields = await currentFieldMap(store);
    const res = await withLockedSyncKv((kv) => runNightly(githubReconcileSource(token, store, fields), store, kv, { force }));
    if (!res.ran) return NextResponse.json({ skipped: "sync-in-progress" });
    invalidateReadCache();
    return NextResponse.json(res.value);
  } catch (e) {
    console.error(`reconcile failed: ${redactError(e)}`);
    return NextResponse.json({ error: "reconcile failed" }, { status: 502 });
  }
});
