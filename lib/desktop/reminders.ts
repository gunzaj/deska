// Reminders and the Dock badge while the window is closed (SPEC §4.6, D12).
//
// The in-app bell fires reminders when the page polls, which stops when the
// window closes. This service does it from the server process instead: every
// 30 s it fires what is due, hands the *new* reminder notifications to the
// Electron main process (which shows them natively), and reports the count
// for the Dock badge. Firing stays idempotent (dedupe keys), so it does not
// matter whether the page or this timer got there first: a notification is
// handed over once, whoever created it.
import type { ReminderItem } from "../../desktop/bridge";
import { LOCAL_OWNER } from "../local-owner";
import { dueCount } from "../tasks/counts";
import { localToday } from "../tasks/dates";
import { fireReminders } from "../tasks/notify";
import { taskRepo } from "../tasks/repo";
import { listTasks } from "../tasks/service";
import { onTasksChanged } from "./events";

/** Well inside the 60 s the spec allows between a reminder coming due and its notification. */
export const TICK_MS = 30_000;
/** A task edit refreshes the badge after this pause, so a burst of edits costs one count. */
const BADGE_DEBOUNCE_MS = 400;

export type { ReminderItem };
export type MainMessage = { type: "reminders"; items: ReminderItem[] } | { type: "badge"; count: number };

export type ReminderState = {
  /** Only reminders created from here on are handed over: older ones were shown by an earlier run. */
  since: number;
  delivered: Set<string>;
  badge: number | null;
};

export const newReminderState = (now = new Date()): ReminderState => ({ since: now.getTime(), delivered: new Set(), badge: null });

/** The zone "today" is read in: the person's setting, else this Mac's. */
async function zone(): Promise<string> {
  const tz = (await taskRepo().prefs(LOCAL_OWNER)).tz;
  return tz ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
}

/**
 * One pass: fire due reminders, return the reminder notifications not yet
 * handed to main, and the badge count if it changed. Pure over the repo, so
 * the tests run it on the in-memory one with a chosen clock.
 */
export async function reminderTick(state: ReminderState, now = new Date(), tz?: string): Promise<{ items: ReminderItem[]; badge: number | null }> {
  await fireReminders(now, LOCAL_OWNER);
  const { list } = await taskRepo().notifications(LOCAL_OWNER, 50);
  const items: ReminderItem[] = [];
  for (const n of list) {
    if (n.kind !== "reminder" || !n.taskId || n.readAt || state.delivered.has(n.id)) continue;
    if (Date.parse(n.createdAt) < state.since) continue;
    state.delivered.add(n.id);
    items.push({ notificationId: n.id, taskId: n.taskId, title: n.title });
  }
  // Oldest first, so several at once appear in the order they came due.
  items.reverse();
  return { items, badge: await badgeChange(state, now, tz) };
}

/** The Dock count when it differs from the last one sent; null when unchanged. */
export async function badgeChange(state: ReminderState, now = new Date(), tz?: string): Promise<number | null> {
  const { tasks, projects } = await listTasks(LOCAL_OWNER);
  const count = dueCount(tasks, projects, localToday(now, tz ?? (await zone())));
  if (count === state.badge) return null;
  state.badge = count;
  return count;
}

// --- wiring ----------------------------------------------------------------

/** Where the server entry registers its line to the main process (desktop/server-entry.ts). */
const MAIN = Symbol.for("deska.mainChannel");
const SERVICE = Symbol.for("deska.reminderService");

const toMain = (msg: MainMessage) => (globalThis as Record<symbol, ((m: MainMessage) => void) | undefined>)[MAIN]?.(msg);

/** Start the 30 s loop once per process. Needs an open database. */
export function startReminderService(): void {
  const g = globalThis as Record<symbol, unknown>;
  if (g[SERVICE]) return;
  const state = newReminderState();
  g[SERVICE] = state;
  let running = false;
  const send = (items: ReminderItem[], badge: number | null) => {
    if (items.length) toMain({ type: "reminders", items });
    if (badge !== null) toMain({ type: "badge", count: badge });
  };
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const r = await reminderTick(state);
      send(r.items, r.badge);
    } catch (e) {
      console.error(`deska: reminder check failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      running = false;
    }
  };
  void tick();
  setInterval(() => void tick(), TICK_MS).unref?.();

  let pending: ReturnType<typeof setTimeout> | null = null;
  onTasksChanged(() => {
    if (pending) return;
    pending = setTimeout(() => {
      pending = null;
      badgeChange(state)
        .then((count) => send([], count))
        .catch(() => undefined);
    }, BADGE_DEBOUNCE_MS);
    pending.unref?.();
  });
}
