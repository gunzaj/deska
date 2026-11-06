// The watchlist digest (IMPROVEMENTS F6): at most one bell entry a day, saying
// how many watched items changed since the person last looked. It is made
// lazily, when their client polls notifications (like reminders, SPEC §12.6),
// and deduped by login and day, so it never fires twice.
import { localToday } from "@/lib/tasks/dates";
import { taskRepo } from "@/lib/tasks/repo";
import { getPrefs } from "@/lib/tasks/service";
import { collectWatchChanges, type WatchQuery } from "./changes";
import { listWatches } from "./repo";

/** How often one person's watches are checked for a digest. */
export const DIGEST_CHECK_MS = 10 * 60_000;
const checkedAt = new Map<string, number>();

export const digestKey = (login: string, day: string) => `watch:${login.toLowerCase()}:${day}`;

export function clearDigestCheck(login: string): void {
  checkedAt.delete(login.toLowerCase());
}

/** True when a digest was added now. */
export async function fireWatchDigest(login: string, now = new Date()): Promise<boolean> {
  const who = login.toLowerCase();
  const last = checkedAt.get(who);
  if (last !== undefined && now.getTime() >= last && now.getTime() - last < DIGEST_CHECK_MS) return false;
  const watches = await listWatches(who);
  if (!watches.length) return false;
  checkedAt.set(who, now.getTime());

  // One digest per day of the viewer's own calendar (v5 4.9).
  const today = localToday(now, (await getPrefs(who)).tz ?? undefined);
  const items: WatchQuery[] = watches.map((w) => ({ kind: w.kind, targetId: w.targetId }));
  const changes = await collectWatchChanges(who, items);
  const changed = Object.values(changes).filter((c) => c.length > 0).length;
  if (!changed) return false;
  return taskRepo().addNotification({
    login: who,
    kind: "watch_digest",
    taskId: null,
    actor: null,
    title: `${changed} watched ${changed === 1 ? "item" : "items"} changed`,
    dedupeKey: digestKey(who, today),
  });
}

/** For tests: forget when people were last checked. */
export function __resetDigestChecks(): void {
  checkedAt.clear();
}
