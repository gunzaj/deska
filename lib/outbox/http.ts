// Checks every write route makes before touching the outbox (W1).
import { NextResponse, type NextRequest } from "next/server";
import { dbDir } from "@/db";
import { viewerToken } from "@/lib/github/viewer-token";
import { getViewerLogin } from "@/lib/session";
import { getStore } from "@/lib/store";
import { redactError } from "@/lib/sync/health";
import type { ReadModel } from "@/lib/sync/read-model";
import { writeEnabled } from "./queue";

export type WriteContext = { viewer: string; token: string; store: ReadModel };

/** The viewer, their own token and the cache — or the response refusing the write. */
export async function writeContext(req: NextRequest): Promise<WriteContext | NextResponse> {
  if (!writeEnabled()) return NextResponse.json({ error: "Editing is off for this deployment (WRITE_MODE=off)" }, { status: 403 });
  // Fixture node IDs are not real issues.
  if (!dbDir()) return NextResponse.json({ error: "no database configured — refusing to write against fixture data" }, { status: 503 });
  // The middleware already requires a session; never write as "unknown".
  const viewer = await getViewerLogin();
  if (!viewer) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  // The acting user's own token, so GitHub history shows the real person —
  // never the shared server token.
  const token = await viewerToken(req, { fallback: false });
  if (!token) return NextResponse.json({ error: "no GitHub token for this user" }, { status: 401 });
  try {
    return { viewer, token, store: await getStore() };
  } catch (e) {
    console.error(`outbox write context: store unavailable: ${redactError(e)}`);
    return NextResponse.json({ error: "store unavailable" }, { status: 503 });
  }
}
