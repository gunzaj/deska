import { NextResponse } from "next/server";
import { writeEnabled } from "@/lib/outbox/queue";
import { etagMatches } from "@/lib/server/data";
import { prDataJson } from "@/lib/server/prs";
import { route, storeUnavailable } from "@/lib/server/route";
import { getStoreWithGeneration } from "@/lib/store";

export const dynamic = "force-dynamic";

// The PR lens's data (SPEC §13.3), loaded after the issue data. Read-only.
// Revalidated with an ETag on the sync generation, like /api/data (S5).
export const GET = route({ auth: "viewer" }, async ({ req, viewer }) => {
  try {
    const { store, generation } = await getStoreWithGeneration();
    const etag = `"${generation}-${encodeURIComponent(viewer.toLowerCase())}-${writeEnabled() ? "w" : "r"}"`;
    const headers = { "cache-control": "private, no-cache", etag };
    if (etagMatches(req.headers.get("if-none-match"), etag)) return new NextResponse(null, { status: 304, headers });
    return new NextResponse(prDataJson(store, viewer), { headers: { ...headers, "content-type": "application/json" } });
  } catch (e) {
    throw storeUnavailable("/api/prs", e);
  }
});
