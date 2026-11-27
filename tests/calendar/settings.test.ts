import { describe, expect, it } from "vitest";
import { applyCalendarPatch, calendarPrefsSchema, DEFAULT_CALENDAR_PREFS, defaultCalendarIds, parseCalendarPrefs } from "@/lib/calendar/settings";

const ids = ["work", "personal", "holidays", "birthdays"];

describe("parseCalendarPrefs (§3.1)", () => {
  it("defaults to reading off, declined hidden, Monday, 08:00–18:00", () => {
    expect(parseCalendarPrefs(null)).toEqual(DEFAULT_CALENDAR_PREFS);
    expect(parseCalendarPrefs("nonsense")).toEqual(DEFAULT_CALENDAR_PREFS);
  });

  it("keeps a stored value and de-duplicates calendar IDs", () => {
    const prefs = parseCalendarPrefs({ enabled: true, calendarIds: ["work", "work", "personal"], hideDeclined: false, weekStart: "sunday", workStart: "07:30", workEnd: "16:00" });
    expect(prefs).toEqual({ enabled: true, calendarIds: ["work", "personal"], hideDeclined: false, weekStart: "sunday", workStart: "07:30", workEnd: "16:00" });
  });

  it("drops calendar IDs this Mac does not know (imported from another Mac)", () => {
    const prefs = parseCalendarPrefs({ enabled: true, calendarIds: ["work", "gone", "personal"] }, ids);
    expect(prefs.calendarIds).toEqual(["work", "personal"]);
    // Without a calendar list, nothing is dropped: the Mac could not be asked.
    expect(parseCalendarPrefs({ enabled: true, calendarIds: ["work", "gone"] }).calendarIds).toEqual(["work", "gone"]);
  });

  it("falls back to the default working range when it is inverted or malformed", () => {
    expect(parseCalendarPrefs({ workStart: "18:00", workEnd: "09:00" })).toMatchObject({ workStart: "08:00", workEnd: "18:00" });
    expect(parseCalendarPrefs({ workStart: "25:00", workEnd: "26:00" })).toMatchObject({ workStart: "08:00", workEnd: "18:00" });
  });
});

describe("applyCalendarPatch (§3.1)", () => {
  it("applies only what the patch names", () => {
    const before = parseCalendarPrefs({ enabled: true, calendarIds: ["work"], hideDeclined: true });
    expect(applyCalendarPatch(before, { hideDeclined: false })).toEqual({ ...before, hideDeclined: false });
  });

  it("keeps the old working range when the new one is inverted", () => {
    const before = parseCalendarPrefs({ workStart: "08:00", workEnd: "18:00" });
    expect(applyCalendarPatch(before, { workStart: "19:00", workEnd: "09:00" })).toMatchObject({ workStart: "08:00", workEnd: "18:00" });
  });

  it("accepts only the documented keys", () => {
    expect(calendarPrefsSchema.safeParse({ calendarIds: ["work"] }).success).toBe(true);
    expect(calendarPrefsSchema.safeParse({ calendarId: "work" }).success).toBe(false);
    expect(calendarPrefsSchema.safeParse({ enabled: "yes" }).success).toBe(false);
  });
});

describe("defaultCalendarIds (§3.1)", () => {
  it("turns every calendar on except subscribed holiday and birthday ones", () => {
    expect(
      defaultCalendarIds([
        { id: "work", subscribed: false, birthday: false },
        { id: "personal", subscribed: false, birthday: false },
        { id: "holidays", subscribed: true, birthday: false },
        { id: "birthdays", subscribed: false, birthday: true },
      ]),
    ).toEqual(["work", "personal"]);
  });
});
