import { describe, expect, it } from "vitest";
import { localTime, zonedToUtc } from "@/lib/tasks/dates";
import { describeRule, firstOccurrence, formatRule, nextOccurrence, parseRule, pinMonthDay } from "@/lib/tasks/recurrence";

describe("nextOccurrence (§12.5)", () => {
  it.each([
    ["FREQ=DAILY", "2026-10-12", "2026-10-13"],
    ["FREQ=DAILY;INTERVAL=3", "2026-10-30", "2026-11-02"],
    ["FREQ=WEEKLY", "2026-10-12", "2026-10-19"],
    ["FREQ=WEEKLY;INTERVAL=2", "2026-10-12", "2026-10-26"],
    ["FREQ=WEEKLY;BYDAY=FR", "2026-10-16", "2026-10-23"], // Fri → next Fri
    ["FREQ=WEEKLY;BYDAY=FR", "2026-10-13", "2026-10-16"], // completed early (every!) → this Fri
    ["FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR", "2026-10-16", "2026-10-19"], // Fri → Mon
    ["FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR", "2026-10-13", "2026-10-14"],
    ["FREQ=WEEKLY;INTERVAL=2;BYDAY=TU", "2026-10-13", "2026-10-27"],
    ["FREQ=MONTHLY", "2026-01-31", "2026-02-28"],
    ["FREQ=MONTHLY;BYMONTHDAY=1", "2026-11-01", "2026-12-01"],
    ["FREQ=MONTHLY;BYMONTHDAY=20", "2026-10-12", "2026-10-20"], // every! before the 20th
    ["FREQ=MONTHLY;BYMONTHDAY=31", "2026-01-31", "2026-02-28"],
    ["FREQ=YEARLY", "2028-02-29", "2029-02-28"],
  ])("%s after %s → %s", (rule, base, next) => {
    expect(nextOccurrence(rule, base)).toBe(next);
  });

  it("rejects rules outside the subset", () => {
    expect(parseRule("FREQ=HOURLY")).toBeNull();
    expect(parseRule("FREQ=WEEKLY;BYDAY=XX")).toBeNull();
    expect(parseRule("FREQ=DAILY;INTERVAL=0")).toBeNull();
    expect(nextOccurrence("nonsense", "2026-10-12")).toBeNull();
  });
});

describe("repeat picker rules", () => {
  it("formats rules Monday first and drops parts the frequency ignores", () => {
    expect(formatRule({ freq: "WEEKLY", interval: 2, byDay: [5, 2], byMonthDay: null })).toBe("FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,FR");
    expect(formatRule({ freq: "WEEKLY", interval: 1, byDay: [0, 1], byMonthDay: 3 })).toBe("FREQ=WEEKLY;BYDAY=MO,SU");
    expect(formatRule({ freq: "MONTHLY", interval: 1, byDay: [2], byMonthDay: 13 })).toBe("FREQ=MONTHLY;BYMONTHDAY=13");
    expect(formatRule({ freq: "YEARLY", interval: 1, byDay: [], byMonthDay: null })).toBe("FREQ=YEARLY");
    for (const rule of ["FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,FR", "FREQ=MONTHLY;INTERVAL=3;BYMONTHDAY=31", "FREQ=DAILY;INTERVAL=4"]) {
      expect(formatRule(parseRule(rule)!)).toBe(rule);
    }
  });

  it.each([
    ["FREQ=DAILY", false, "every day"],
    ["FREQ=DAILY;INTERVAL=3", true, "every 3 days after completion"],
    ["FREQ=WEEKLY", false, "every week"],
    ["FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR", false, "every weekday"],
    ["FREQ=WEEKLY;BYDAY=FR", false, "every friday"],
    ["FREQ=WEEKLY;BYDAY=FR,TU", false, "every tue, fri"],
    ["FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,FR", false, "every 2 weeks on tue, fri"],
    ["FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TU,WE,TH,FR", false, "every 2 weeks on mon, tue, wed, thu, fri"],
    ["FREQ=MONTHLY;BYMONTHDAY=13", false, "every month on the 13th"],
    ["FREQ=MONTHLY;INTERVAL=2;BYMONTHDAY=22", false, "every 2 months on the 22nd"],
    ["FREQ=MONTHLY;BYMONTHDAY=31", false, "every month on the last day"],
    ["FREQ=YEARLY;INTERVAL=2", false, "every 2 years"],
  ])("describes %s", (rule, fromCompletion, text) => {
    expect(describeRule(rule, fromCompletion)).toBe(text);
  });

  it("starts on the first matching day on or after the due date", () => {
    expect(firstOccurrence("FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,FR", "2026-10-12")).toBe("2026-10-13"); // Mon → Tue
    expect(firstOccurrence("FREQ=WEEKLY;BYDAY=TU", "2026-10-13")).toBe("2026-10-13");
    expect(firstOccurrence("FREQ=WEEKLY;BYDAY=MO", "2026-10-13")).toBe("2026-10-19");
    expect(firstOccurrence("FREQ=MONTHLY;BYMONTHDAY=20", "2026-10-13")).toBe("2026-10-20");
    expect(firstOccurrence("FREQ=MONTHLY;BYMONTHDAY=5", "2026-10-13")).toBe("2026-11-05");
    expect(firstOccurrence("FREQ=MONTHLY;BYMONTHDAY=31", "2026-11-13")).toBe("2026-11-30");
    expect(firstOccurrence("FREQ=DAILY;INTERVAL=3", "2026-10-13")).toBe("2026-10-13");
  });

  it("every 2 weeks on Tue and Fri runs Tue, Fri, then skips a week", () => {
    const rule = "FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,FR";
    const dates = ["2026-10-13"];
    for (let i = 0; i < 4; i++) dates.push(nextOccurrence(rule, dates[i]!)!);
    expect(dates).toEqual(["2026-10-13", "2026-10-16", "2026-10-27", "2026-10-30", "2026-11-10"]);
  });
});

describe("pinMonthDay", () => {
  it("pins a bare monthly rule that starts on the 29th–31st, and nothing else", () => {
    const r = (rule: string, fromCompletion = false) => ({ rule, text: "every month", fromCompletion });
    expect(pinMonthDay(r("FREQ=MONTHLY"), "2026-01-31").rule).toBe("FREQ=MONTHLY;BYMONTHDAY=31");
    expect(pinMonthDay(r("FREQ=MONTHLY;INTERVAL=2"), "2026-03-29").rule).toBe("FREQ=MONTHLY;INTERVAL=2;BYMONTHDAY=29");
    expect(pinMonthDay(r("FREQ=MONTHLY"), "2026-01-28").rule).toBe("FREQ=MONTHLY");
    expect(pinMonthDay(r("FREQ=MONTHLY", true), "2026-01-31").rule).toBe("FREQ=MONTHLY");
    expect(pinMonthDay(r("FREQ=MONTHLY;BYMONTHDAY=1"), "2026-01-31").rule).toBe("FREQ=MONTHLY;BYMONTHDAY=1");
    expect(pinMonthDay(r("FREQ=WEEKLY"), "2026-01-31").rule).toBe("FREQ=WEEKLY");
  });
});

describe("yearly recurrence keeps its day (v5 2.11)", () => {
  it("29 Feb comes back in a leap year instead of settling on the 28th", () => {
    const rule = pinMonthDay({ rule: "FREQ=YEARLY", fromCompletion: false }, "2028-02-29").rule;
    expect(rule).toBe("FREQ=YEARLY;BYMONTHDAY=29");
    let d = "2028-02-29";
    const seen: string[] = [];
    for (let i = 0; i < 4; i++) seen.push((d = nextOccurrence(rule, d)!));
    expect(seen).toEqual(["2029-02-28", "2030-02-28", "2031-02-28", "2032-02-29"]);
  });

  it("an unpinned yearly rule keeps the base's month and day, and honours INTERVAL", () => {
    expect(nextOccurrence("FREQ=YEARLY", "2026-10-12")).toBe("2027-10-12");
    expect(nextOccurrence("FREQ=YEARLY;INTERVAL=2", "2026-10-12")).toBe("2028-10-12");
    expect(pinMonthDay({ rule: "FREQ=YEARLY", fromCompletion: false }, "2026-10-12").rule).toBe("FREQ=YEARLY"); // day <= 28
  });
});

describe("zonedToUtc", () => {
  it("converts a Prague wall time in summer and winter", () => {
    expect(zonedToUtc("2026-07-01", "15:00", "Europe/Prague").toISOString()).toBe("2026-07-01T13:00:00.000Z");
    expect(zonedToUtc("2026-12-01", "15:00", "Europe/Prague").toISOString()).toBe("2026-12-01T14:00:00.000Z");
  });
  it("handles DST changes", () => {
    // 2026-10-25 03:00 CEST → 02:00 CET; 09:00 that day is CET.
    expect(zonedToUtc("2026-10-25", "09:00", "Europe/Prague").toISOString()).toBe("2026-10-25T08:00:00.000Z");
    expect(zonedToUtc("2026-03-29", "09:00", "Europe/Prague").toISOString()).toBe("2026-03-29T07:00:00.000Z");
    expect(zonedToUtc("2026-10-12", "09:00", "UTC").toISOString()).toBe("2026-10-12T09:00:00.000Z");
  });
  it("formats local time", () => {
    expect(localTime(new Date("2026-10-12T13:05:00Z"), "Europe/Prague")).toBe("15:05");
  });
});
