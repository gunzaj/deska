import { resetGithubCache } from "@/lib/backup/local-data";
import { localData } from "@/lib/server/local-data-http";
import { route } from "@/lib/server/route";

export const dynamic = "force-dynamic";

/** Settings → Reset GitHub cache: re-import from GitHub, tasks and settings kept (D8). */
export const POST = route({ auth: "public" }, () => localData(async () => (await resetGithubCache(), { ok: true })));
