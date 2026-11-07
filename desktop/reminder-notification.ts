// How a fired reminder looks as a native notification (SPEC §4.6): the title
// of the task, and three buttons. Pure, so the mapping from a button to what
// it does has a unit test; main wires it to Electron's Notification.
import type { ReminderAction, ReminderItem } from "./bridge";

/** Button order is the macOS action order: the index Electron reports. */
export const REMINDER_ACTIONS: { action: ReminderAction; text: string }[] = [
  { action: "complete", text: "Complete" },
  { action: "snooze1h", text: "Snooze 1 h" },
  { action: "tomorrow", text: "Tomorrow" },
];

export function reminderOptions(item: ReminderItem) {
  return {
    title: item.title.slice(0, 200) || "Reminder",
    body: "Reminder · Deska",
    actions: REMINDER_ACTIONS.map((a) => ({ type: "button" as const, text: a.text })),
    closeButtonText: "Dismiss",
  };
}

/** The action behind button `index`, or null for an index that is not one of ours. */
export function actionAt(index: number): ReminderAction | null {
  return REMINDER_ACTIONS[index]?.action ?? null;
}

/** The local API call an action makes (path and body); marking the notification read follows separately. */
export function actionRequest(action: ReminderAction, taskId: string): { method: "PATCH" | "POST"; path: string; body: unknown } {
  const id = encodeURIComponent(taskId);
  if (action === "complete") return { method: "PATCH", path: `/api/tasks/${id}`, body: { completed: true } };
  return { method: "POST", path: `/api/tasks/${id}/snooze`, body: { for: action === "snooze1h" ? "1h" : "tomorrow" } };
}
