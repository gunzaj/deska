import { z } from "zod";
import { importLocalData } from "@/lib/backup/local-data";
import { localData } from "@/lib/server/local-data-http";
import { route } from "@/lib/server/route";
import { syncService } from "@/lib/sync/service";

export const dynamic = "force-dynamic";

/** Settings → Import: merge an export or backup file by ID. Never touches the GitHub cache (D8). */
export const POST = route({ auth: "public", body: z.unknown(), invalid: "not a Deska backup or export file" }, ({ body }) =>
  localData(async () => {
    const result = await importLocalData(body);
    // An imported project and mapping may be what a fresh install was waiting for.
    void syncService().request("project");
    return result;
  }),
);
