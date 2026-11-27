import { describe, expect, it } from "vitest";
import { allDayDates, DAY_MINUTES, eventTimeLabel, layoutDay, meetingsOn, nextMeeting } from "@/lib/calendar/layout";
import type { CalendarEventView } from "@/lib/calendar/types";

let n = 0;
function event(over: Partial<CalendarEventView> & Pick<CalendarEventView, "start" | "end">): CalendarEventView {
  n++;
  return {
    id: `e${n}`,
    calendarId: "work",
    title: `Meeting ${n}`,
    allDay: false,
    timeZone: null,
    location: null,
    url: null,
    myStatus: "accepted",
    organizerIsMe: false,
    attendeeCount: 0,
    isRecurring: false,
    occurrenceDate: null,
    calendarTitle: "Work",
    calendarColor: "#3366cc",
    joinUrl: null,
    ...over,
  };
}

const opts = { tz: "UTC", workStart: "08:00", workEnd: "18:00", hideDeclined: true };

describe("layoutDay (§3.5)", () => {
  it("draws a zero-length event, since it is counted as a meeting", () => {
    const day = layoutDay([event({ start: "2026-11-27T10:00:00Z", end: "2026-11-27T10:00:00Z" })], "2026-11-27", opts);
    expect(day.timed.map((t) => [t.startMin, t.endMin])).toEqual([[600, 601]]);
  });

  it("puts overlapping events side by side", () => {
    const a = event({ start: "2026-11-27T10:00:00Z", end: "2026-11-27T11:00:00Z" });
    const b = event({ start: "2026-11-27T10:30:00Z", end: "2026-11-27T11:30:00Z" });
    const c = event({ start: "2026-11-27T12:00:00Z", end: "2026-11-27T13:00:00Z" });
    const day = layoutDay([a, b, c], "2026-11-27", opts);
    const byId = new Map(day.timed.map((t) => [t.event.id, t]));
    expect([byId.get(a.id)!.column, byId.get(a.id)!.columns]).toEqual([0, 2]);
    expect([byId.get(b.id)!.column, byId.get(b.id)!.columns]).toEqual([1, 2]);
    // A gap ends the group: the noon meeting is alone again.
    expect([byId.get(c.id)!.column, byId.get(c.id)!.columns]).toEqual([0, 1]);
  });

  it("keeps all-day events in their band and off the grid", () => {
    const allDay = event({ start: "2026-11-27T00:00:00Z", end: "2026-11-28T00:00:00Z", allDay: true });
    const day = layoutDay([allDay], "2026-11-27", opts);
    expect(day.allDay.map((e) => e.id)).toEqual([allDay.id]);
    expect(day.timed).toEqual([]);
    // The exclusive end at midnight is the next day, not a second day.
    expect(allDayDates(allDay, "UTC")).toEqual(["2026-11-27"]);
  });

  it("filters declined events unless the pref says otherwise", () => {
    const declined = event({ start: "2026-11-27T09:00:00Z", end: "2026-11-27T09:30:00Z", myStatus: "declined" });
    expect(layoutDay([declined], "2026-11-27", opts).timed).toHaveLength(0);
    expect(layoutDay([declined], "2026-11-27", { ...opts, hideDeclined: false }).timed).toHaveLength(1);
    expect(meetingsOn([declined], "2026-11-27", "UTC", true)).toEqual([]);
  });

  it("opens on working hours and grows for early and late events", () => {
    const early = event({ start: "2026-11-27T07:00:00Z", end: "2026-11-27T07:30:00Z" });
    const late = event({ start: "2026-11-27T19:00:00Z", end: "2026-11-27T20:00:00Z" });
    const day = layoutDay([early, late], "2026-11-27", opts);
    expect(day.windowStart).toBe(7 * 60);
    expect(day.windowEnd).toBe(20 * 60);
    // With no events the window is the working day.
    expect(layoutDay([], "2026-11-27", opts)).toMatchObject({ windowStart: 8 * 60, windowEnd: 18 * 60 });
  });

  it("draws wall-clock positions across a spring-forward day", () => {
    // Berlin: 02:00 → 03:00 on 29 March 2026. 01:00 CET is 00:00Z; 04:00 CEST is 02:00Z.
    const day = layoutDay([event({ start: "2026-03-29T00:00:00Z", end: "2026-03-29T02:00:00Z" })], "2026-03-29", { ...opts, tz: "Europe/Berlin" });
    expect(day.timed[0]).toMatchObject({ startMin: 60, endMin: 4 * 60 });
    expect(day.timed[0]!.endMin - day.timed[0]!.startMin).toBe(180);
  });

  it("clips an event that crosses midnight to each day", () => {
    const night = event({ start: "2026-11-27T22:00:00Z", end: "2026-11-28T02:00:00Z" });
    const first = layoutDay([night], "2026-11-27", { ...opts, workStart: "00:00", workEnd: "24:00" });
    expect(first.timed[0]).toMatchObject({ startMin: 22 * 60, endMin: DAY_MINUTES, continuesBefore: false, continuesAfter: true });
    const second = layoutDay([night], "2026-11-28", { ...opts, workStart: "00:00", workEnd: "24:00" });
    expect(second.timed[0]).toMatchObject({ startMin: 0, endMin: 2 * 60, continuesBefore: true, continuesAfter: false });
  });

  it("marks the now-line only on the viewer's today", () => {
    const now = new Date("2026-11-27T10:15:00Z");
    expect(layoutDay([], "2026-11-27", { ...opts, now }).nowMin).toBe(10 * 60 + 15);
    expect(layoutDay([], "2026-11-28", { ...opts, now }).nowMin).toBeNull();
  });
});

describe("nextMeeting (§3.2)", () => {
  it("names the meeting starting within two hours", () => {
    const soon = event({ title: "Design review", start: "2026-11-27T10:00:00Z", end: "2026-11-27T10:30:00Z" });
    expect(nextMeeting([soon], new Date("2026-11-27T09:35:00Z"), "UTC", true)).toEqual({ kind: "next", title: "Design review", minutes: 25 });
  });

  it("says which meeting is running, and until when", () => {
    const running = event({ title: "Standup", start: "2026-11-27T09:00:00Z", end: "2026-11-27T09:45:00Z" });
    expect(nextMeeting([running], new Date("2026-11-27T09:15:00Z"), "UTC", true)).toEqual({ kind: "now", title: "Standup", until: "09:45" });
  });

  it("counts free time until a meeting further out, and all-day events don't count", () => {
    const later = event({ start: "2026-11-27T14:00:00Z", end: "2026-11-27T15:00:00Z" });
    const allDay = event({ start: "2026-11-27T00:00:00Z", end: "2026-11-28T00:00:00Z", allDay: true });
    expect(nextMeeting([allDay, later], new Date("2026-11-27T09:00:00Z"), "UTC", true)).toEqual({ kind: "free", until: "14:00" });
    expect(nextMeeting([], new Date("2026-11-27T09:00:00Z"), "UTC", true)).toEqual({ kind: "free", until: null });
  });
});

describe("labels", () => {
  it("shows times in the viewer's zone and all-day events as All day", () => {
    const timed = event({ start: "2026-11-27T14:00:00Z", end: "2026-11-27T15:30:00Z" });
    expect(eventTimeLabel(timed, "UTC")).toBe("14:00–15:30");
    expect(eventTimeLabel(timed, "Europe/Berlin")).toBe("15:00–16:30");
    expect(eventTimeLabel(event({ start: "2026-11-27T00:00:00Z", end: "2026-11-28T00:00:00Z", allDay: true }), "UTC")).toBe("All day");
  });
});
