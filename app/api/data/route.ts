import { NextResponse } from "next/server";
import { route, storeUnavailable } from "@/lib/server/route";
import { etagMatches, loadClientData } from "@/lib/server/data";

export const dynamic = "force-dynamic";

/**
 * Compact issue rows + metadata for the browser (bodies are fetched per
 * issue). Revalidated with an ETag on the sync generation (S5): an unchanged
 * cache answers 304 instead of the full payload.
 */
export const GET = route({ auth: "viewer" }, async ({ req }) => {
  const { etag, json } = await loadClientData().catch((e: unknown) => {
    throw storeUnavailable("/api/data", e);
  });
  const headers = { "cache-control": "private, no-cache", etag };
  if (etagMatches(req.headers.get("if-none-match"), etag)) return new NextResponse(null, { status: 304, headers });
  // The serialized body is built once per generation and served as is.
  return new NextResponse(json(), { headers: { ...headers, "content-type": "application/json" } });
});
