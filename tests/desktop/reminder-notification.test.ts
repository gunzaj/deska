import { describe, expect, it } from "vitest";
import { actionAt, actionRequest, reminderOptions, REMINDER_ACTIONS } from "../../desktop/reminder-notification";

describe("a reminder as a native notification (D12)", () => {
  it("shows the task title with Complete, Snooze 1 h and Tomorrow", () => {
    const o = reminderOptions({ notificationId: "n1", taskId: "t1", title: "Pay rent" });
    expect(o.title).toBe("Pay rent");
    expect(o.actions.map((a) => a.text)).toEqual(["Complete", "Snooze 1 h", "Tomorrow"]);
  });

  it("caps a huge title and never shows an empty one", () => {
    expect(reminderOptions({ notificationId: "n", taskId: "t", title: "x".repeat(500) }).title).toHaveLength(200);
    expect(reminderOptions({ notificationId: "n", taskId: "t", title: "" }).title).toBe("Reminder");
  });

  it("maps each button to its action; an unknown index is nothing", () => {
    expect(REMINDER_ACTIONS.map((_, i) => actionAt(i))).toEqual(["complete", "snooze1h", "tomorrow"]);
    expect(actionAt(3)).toBeNull();
    expect(actionAt(-1)).toBeNull();
  });

  it("each action is one local API call; none touches GitHub", () => {
    expect(actionRequest("complete", "t 1")).toEqual({ method: "PATCH", path: "/api/tasks/t%201", body: { completed: true } });
    expect(actionRequest("snooze1h", "t1")).toEqual({ method: "POST", path: "/api/tasks/t1/snooze", body: { for: "1h" } });
    expect(actionRequest("tomorrow", "t1")).toEqual({ method: "POST", path: "/api/tasks/t1/snooze", body: { for: "tomorrow" } });
  });
});
