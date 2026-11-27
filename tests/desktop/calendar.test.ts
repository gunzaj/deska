// CALENDAR-SPEC §2.2: the helper bridge in fixture mode (tests and dev), and
// the promise that only the documented event fields leave this module.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { CalendarHelper } from "@/desktop/calendar";

const dir = mkdtempSync(path.join(tmpdir(), "deska-calendar-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function fixtureFile(name: string, body: unknown): string {
  const file = path.join(dir, name);
  writeFileSync(file, JSON.stringify(body));
  return file;
}

const calendars = [
  { id: "work", title: "Work", color: "#3366cc", source: "iCloud", allowsWrite: true, subscribed: false, birthday: false },
  { id: "holidays", title: "Holidays", color: "#cc3333", source: "iCloud", allowsWrite: false, subscribed: true, birthday: false },
];

const events = [
  {
    id: "a",
    calendarId: "work",
    title: "Design review",
    start: "2026-11-27T10:00:00Z",
    end: "2026-11-27T11:00:00Z",
    allDay: false,
    myStatus: "accepted",
    notes: "Secret notes",
    meetingUrl: "https://meet.google.com/abc-defg-hij",
    attendees: [{ email: "alice@example.com" }],
  },
  { id: "b", calendarId: "work", title: "Later", start: "2026-11-27T15:00:00Z", end: "2026-11-27T16:00:00Z", allDay: false },
  { id: "c", calendarId: "holidays", title: "Holiday", start: "2026-11-27T00:00:00Z", end: "2026-11-28T00:00:00Z", allDay: true },
  { id: "d", calendarId: "work", title: "Tomorrow", start: "2026-11-28T09:00:00Z", end: "2026-11-28T10:00:00Z", allDay: false },
];

describe("CalendarHelper fixtures (§2.2)", () => {
  it("answers status and calendars, and drops fields the spec never reads", async () => {
    const helper = new CalendarHelper(null, fixtureFile("ok.json", { status: "fullAccess", calendars, events }));
    expect(helper.fixtureMode).toBe(true);
    expect(await helper.status()).toBe("fullAccess");
    expect(await helper.calendars()).toEqual(calendars);

    const [first] = await helper.events("2026-11-27T00:00:00Z", "2026-11-28T00:00:00Z", ["work"]);
    expect(first).toMatchObject({ id: "a", title: "Design review", allDay: false });
    // Notes and attendee details are not part of the shape, even if a fixture has them.
    expect(first).not.toHaveProperty("notes");
    expect(first!.meetingUrl).toBe("https://meet.google.com/abc-defg-hij");
    expect(first).not.toHaveProperty("attendees");
    expect(Object.keys(first!).sort()).toEqual(
      ["allDay", "attendeeCount", "calendarId", "end", "id", "isRecurring", "location", "meetingUrl", "myStatus", "occurrenceDate", "organizerIsMe", "start", "timeZone", "title", "url"].sort(),
    );
  });

  it("filters by chosen calendar and by window, in order", async () => {
    const helper = new CalendarHelper(null, fixtureFile("window.json", { status: "fullAccess", calendars, events }));
    const day = await helper.events("2026-11-27T00:00:00Z", "2026-11-28T00:00:00Z", ["work"]);
    expect(day.map((e) => e.id)).toEqual(["a", "b"]);
    const holiday = await helper.events("2026-11-27T00:00:00Z", "2026-11-28T00:00:00Z", ["holidays"]);
    expect(holiday.map((e) => e.id)).toEqual(["c"]);
  });

  it("reads nothing without access, and refuses an impossible window", async () => {
    const denied = new CalendarHelper(null, fixtureFile("denied.json", { status: "denied", calendars, events }));
    expect(await denied.calendars()).toEqual([]);
    expect(await denied.events("2026-11-27T00:00:00Z", "2026-11-28T00:00:00Z", ["work"])).toEqual([]);

    const helper = new CalendarHelper(null, fixtureFile("bad-window.json", { status: "fullAccess", calendars, events }));
    await expect(helper.events("2026-11-28T00:00:00Z", "2026-11-27T00:00:00Z", ["work"])).rejects.toThrow("invalid calendar window");
    await expect(helper.events("2026-01-01T00:00:00Z", "2026-03-01T00:00:00Z", ["work"])).rejects.toThrow("invalid calendar window");
  });

  it("drops a link from the notes that is not on the meeting allowlist", async () => {
    const odd = [{ id: "x", calendarId: "work", title: "X", start: "2026-11-27T10:00:00Z", end: "2026-11-27T11:00:00Z", allDay: false, meetingUrl: "https://evil.example/join" }];
    const helper = new CalendarHelper(null, fixtureFile("odd-link.json", { status: "fullAccess", calendars, events: odd }));
    const [first] = await helper.events("2026-11-27T00:00:00Z", "2026-11-28T00:00:00Z", ["work"]);
    expect(first!.meetingUrl).toBeNull();
  });

  it("reads nothing with write-only access", async () => {
    const helper = new CalendarHelper(null, fixtureFile("write-only.json", { status: "writeOnly", calendars, events }));
    expect(await helper.calendars()).toEqual([]);
    expect(await helper.events("2026-11-27T00:00:00Z", "2026-11-28T00:00:00Z", ["work"])).toEqual([]);
  });

  it("says unavailable when there is neither a helper nor a fixture", async () => {
    const helper = new CalendarHelper(null, null);
    expect(await helper.status()).toBe("unavailable");
    await expect(helper.events("2026-11-27T00:00:00Z", "2026-11-28T00:00:00Z", ["work"])).rejects.toThrow("not available");
  });
});
