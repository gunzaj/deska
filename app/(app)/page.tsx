import { redirect } from "next/navigation";
import { desktopGuard } from "@/lib/desktop/guard";
import { LOCAL_OWNER } from "@/lib/local-owner";
import { readTasksOnly } from "@/lib/settings";
import { startPath } from "@/lib/tasks/model";
import { getPrefs } from "@/lib/tasks/service";

export const dynamic = "force-dynamic";

/** "/" opens the start page (HOME-SPEC §3.1): Home unless Settings → General says My issues or Today. */
export default async function Start() {
  const tasksOnly = desktopGuard() !== null && (await readTasksOnly());
  // Prefs are local data: they belong to this install, whichever account is connected.
  const startPage = (await getPrefs(LOCAL_OWNER).catch(() => null))?.startPage;
  redirect(startPath(startPage, tasksOnly));
}
