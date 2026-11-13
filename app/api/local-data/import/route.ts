import { NextResponse } from "next/server";
import { z } from "zod";
import { importLocalData, MAX_IMPORT_BYTES } from "@/lib/backup/local-data";
import { localData } from "@/lib/server/local-data-http";
import { route } from "@/lib/server/route";
import { syncService } from "@/lib/sync/service";

export const dynamic = "force-dynamic";

/** Settings → Import: merge an export or backup file by ID. Never touches the GitHub cache (D8). */
const handler = route({ auth: "public", body: z.unknown(), invalid: "not a Deska backup or export file" }, ({ body }) =>
  localData(async () => {
    const result = await importLocalData(body);
    // An imported project and mapping may be what a fresh install was waiting for.
    void syncService().request("project");
    return result;
  }),
);

export const POST = async (req: Request): Promise<Response> => {
  // A body the server would cut off reads as "not a Deska file"; say what is wrong instead.
  if (Number(req.headers.get("content-length") ?? 0) > MAX_IMPORT_BYTES) {
    return NextResponse.json({ error: "This file is too large to import (over 100 MB)." }, { status: 413 });
  }
  return handler(req);
};
