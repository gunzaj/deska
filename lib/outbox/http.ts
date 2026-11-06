// Checks every write route makes before touching the outbox (W1).
import { NextResponse } from "next/server";
import { dbDir } from "@/db";
import { localToken } from "@/lib/github/local-token";
import { getViewerLogin } from "@/lib/session";
import { getStore } from "@/lib/store";
import { redactError } from "@/lib/sync/health";
import type { ReadModel } from "@/lib/sync/read-model";
import { writeEnabled } from "./queue";

export type WriteContext = { viewer: string; token: string; store: ReadModel };

/** The viewer, their own token and the cache — or the response refusing the write. */
export async function writeContext(): Promise<WriteContext | NextResponse> {
  if (!writeEnabled()) return NextResponse.json({ error: "Editing is off for this deployment (WRITE_MODE=off)" }, { status: 403 });
  // Fixture node IDs are not real issues.
  if (!dbDir()) return NextResponse.json({ error: "no database configured — refusing to write against fixture data" }, { status: 503 });
  // Never write as "unknown".
  const viewer = await getViewerLogin();
  if (!viewer) return NextResponse.json({ error: "GitHub is not connected" }, { status: 401 });
  // The local user's own token (held in memory, SPEC §2.3).
  const token = localToken();
  if (!token) return NextResponse.json({ error: "GitHub is not connected" }, { status: 401 });
  try {
    return { viewer, token, store: await getStore() };
  } catch (e) {
    console.error(`outbox write context: store unavailable: ${redactError(e)}`);
    return NextResponse.json({ error: "store unavailable" }, { status: 503 });
  }
}
