import { z } from "zod";
import { writeBackup } from "@/lib/backup/files";
import { resetEverything } from "@/lib/backup/local-data";
import { localData } from "@/lib/server/local-data-http";
import { route } from "@/lib/server/route";

export const dynamic = "force-dynamic";

/**
 * Settings → Reset everything (D8). The page asks twice; the request carries
 * the second answer, so a stray call does nothing. A backup goes first.
 */
export const POST = route({ auth: "public", body: z.object({ confirm: z.literal("reset-everything") }).strict(), invalid: "confirmation missing" }, () =>
  localData(async () => {
    const backup = await writeBackup("reset");
    await resetEverything();
    return { ok: true, backup: backup?.name ?? null };
  }),
);
