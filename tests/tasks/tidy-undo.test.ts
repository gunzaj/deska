// Item 12/13: the patch that undoes a Tidy Inbox edit. A moved due date
// re-pins the day of the month on the server, so Undo restores the rule too.
import { describe, expect, it } from "vitest";
import { undoPatchOf } from "@/lib/tasks/undo";
import type { Task } from "@/lib/tasks/model";

const task = (over: Partial<Task> = {}): Task => ({
  id: "t1",
  creator: "local",
  parentId: null,
  sectionId: null,
  title: "Rent",
  description: "",
  priority: 4,
  dueDate: "2026-11-30",
  dueTime: null,
  dueTz: null,
  recurrence: { rule: "FREQ=MONTHLY;BYMONTHDAY=30", text: "every month", fromCompletion: false },
  reminders: [],
  completedAt: null,
  completedBy: null,
  links: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  projectId: null,
  position: 1,
  labels: [],
  ...over,
});

describe("undoing a Tidy Inbox edit", () => {
  it("restores the day of the month a moved date re-pinned", () => {
    const t = task();
    expect(undoPatchOf(t, { dueDate: "2026-11-15" }, [])).toEqual({ dueDate: "2026-11-30", dueTime: null, recurrence: t.recurrence });
  });

  it("does not override a recurrence the edit itself named", () => {
    const t = task();
    const next = { rule: "FREQ=WEEKLY;BYDAY=FR", text: "every friday", fromCompletion: false };
    expect(undoPatchOf(t, { dueDate: "2026-11-15", recurrence: next }, []).recurrence).toBe(t.recurrence);
  });

  it("leaves a task without a recurrence without one", () => {
    const t = task({ recurrence: null });
    expect(undoPatchOf(t, { dueDate: "2026-11-15" }, [])).toEqual({ dueDate: "2026-11-30", dueTime: null, recurrence: null });
  });
});
