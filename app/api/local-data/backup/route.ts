import { writeBackup } from "@/lib/backup/files";
import { localData } from "@/lib/server/local-data-http";
import { route, HttpError } from "@/lib/server/route";

export const dynamic = "force-dynamic";

/** Settings → Back up now. */
export const POST = route({ auth: "public" }, () =>
  localData(async () => {
    const info = await writeBackup("manual");
    if (!info) throw new HttpError(409, "Backups are not enabled in this run.");
    return info;
  }),
);
