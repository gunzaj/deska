import { z } from "zod";
import { recoverDatabase } from "@/lib/backup/recover";
import { startDesktopServices } from "@/lib/desktop/startup";
import { localData } from "@/lib/server/local-data-http";
import { route } from "@/lib/server/route";

export const dynamic = "force-dynamic";

/**
 * After the database failed to open (D8): restore the latest backup, or start
 * empty. Only valid while the database is in the failed state; the desktop
 * shell calls it from its own dialog.
 */
export const POST = route({ auth: "public", body: z.object({ mode: z.enum(["restore", "fresh"]) }).strict(), invalid: "invalid mode" }, ({ body }) =>
  localData(() => recoverDatabase(body.mode, () => process.env.DESKA_DESKTOP === "1" && startDesktopServices())),
);
