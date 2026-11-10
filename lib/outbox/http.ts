// Checks every write route makes before touching the outbox (W1).
import { NextResponse } from "next/server";
import { dbDir } from "@/db";
import { localToken } from "@/lib/github/local-token";
import { getViewerLogin } from "@/lib/session";
import { getStore } from "@/lib/store";
import { redactError } from "@/lib/sync/health";
import type { ReadModel } from "@/lib/sync/read-model";
import { writeGate, WRITE_MESSAGES } from "@/lib/writes/gate";

export type WriteContext = { viewer: string; token: string; store: ReadModel };

/**
 * The viewer, their own token and the cache — or the response refusing the
 * write. Every write route goes through this, so SPEC §3.4's three-part gate is
 * checked in one place.
 */
export async function writeContext(): Promise<WriteContext | NextResponse> {
  const gate = await writeGate();
  if (!gate.allowed) return NextResponse.json({ error: gate.reason ?? WRITE_MESSAGES.settingOff, writesOff: true }, { status: 403 });
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
