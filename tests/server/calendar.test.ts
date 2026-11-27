// CALENDAR-SPEC §2.2, §3.1: the calendar routes compose the helper's data with
// the saved prefs; nothing is stored, and a denied or disabled calendar reads
// nothing rather than an empty day.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { CalendarEvent, CalendarInfo, CalendarReadStatus } from "@/lib/calendar/types";
import { parseCalendarPrefs, type CalendarPrefs } from "@/lib/calendar/settings";

const state = vi.hoisted(() => ({
  status: "fullAccess" as CalendarReadStatus,
  calendars: [] as CalendarInfo[],
  events: [] as CalendarEvent[],
  prefs: { enabled: true, calendarIds: ["work"], hideDeclined: true, weekStart: "monday", workStart: "08:00", workEnd: "18:00" } as CalendarPrefs,
  saved: [] as unknown[],
  known: undefined as string[] | undefined,
}));

vi.mock("@/lib/session", () => ({ getViewerLogin: async () => "alice" }));
vi.mock("@/lib/settings", () => ({
  readCalendarPrefs: async (known?: Iterable<string>) => {
    state.known = known ? [...known] : undefined;
    return state.prefs;
  },
  saveCalendarPrefs: async (prefs: unknown) => {
    state.saved.push(prefs);
    state.prefs = prefs as typeof state.prefs;
  },
}));
vi.mock("@/lib/calendar/provider", () => ({
  calendarStatus: async () => state.status,
  calendarCalendars: async () => state.calendars,
  calendarEvents: async () => state.events,
}));

const eventsRoute = await import("@/app/api/calendar/events/route");
const calendarRoute = await import("@/app/api/calendar/route");

const work: CalendarInfo = { id: "work", title: "Work", color: "#3366cc", source: "iCloud", allowsWrite: true, subscribed: false, birthday: false };
const holidays: CalendarInfo = { id: "holidays", title: "Holidays", color: "#cc3333", source: "iCloud", allowsWrite: false, subscribed: true, birthday: false };

const ev = (over: Partial<CalendarEvent> & Pick<CalendarEvent, "id" | "calendarId" | "start" | "end">): CalendarEvent => ({
  title: over.id,
  allDay: false,
  timeZone: null,
  location: null,
  url: null,
  myStatus: "accepted",
  organizerIsMe: false,
  attendeeCount: 0,
  isRecurring: false,
  occurrenceDate: null,
  ...over,
});

function get(url: string) {
  return new NextRequest(`http://app.test${url}`);
}

const DAY = "from=2026-11-27T00%3A00%3A00Z&to=2026-11-28T00%3A00%3A00Z";

beforeEach(() => {
  state.status = "fullAccess";
  state.calendars = [work, holidays];
  state.events = [];
  state.prefs = parseCalendarPrefs({ enabled: true, calendarIds: ["work"] });
  state.saved = [];
  state.known = undefined;
});

describe("GET /api/calendar/events (§2.2, §3.2)", () => {
  it("returns the chosen calendars' events with the drawing rules, and no notes", async () => {
    state.events = [
      ev({ id: "later", calendarId: "work", title: "Later", start: "2026-11-27T15:00:00Z", end: "2026-11-27T16:00:00Z" }),
      ev({ id: "call", calendarId: "work", title: "Call", start: "2026-11-27T10:00:00Z", end: "2026-11-27T11:00:00Z", location: "https://acme.zoom.us/j/1." }),
      ev({ id: "declined", calendarId: "work", title: "Declined", start: "2026-11-27T09:00:00Z", end: "2026-11-27T09:30:00Z", myStatus: "declined" }),
      ev({ id: "holiday", calendarId: "holidays", title: "Holiday", start: "2026-11-27T00:00:00Z", end: "2026-11-28T00:00:00Z", allDay: true }),
    ];
    const res = await eventsRoute.GET(get(`/api/calendar/events?${DAY}`));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      connected: boolean;
      calendars: { id: string }[];
      events: { id: string; joinUrl: string | null; calendarTitle: string }[];
      prefs: { workStart: string };
    };
    expect(body.connected).toBe(true);
    expect(body.calendars.map((c) => c.id)).toEqual(["work"]);
    expect(body.events.map((e) => e.id)).toEqual(["call", "later"]);
    expect(body.events[0]!.calendarTitle).toBe("Work");
    expect(body.events[0]!.joinUrl).toBe("https://acme.zoom.us/j/1");
    expect(body.prefs.workStart).toBe("08:00");
  });

  it("reads nothing when reading is off or macOS said no", async () => {
    state.prefs = parseCalendarPrefs({ enabled: false, calendarIds: ["work"] });
    let body = (await (await eventsRoute.GET(get(`/api/calendar/events?${DAY}`))).json()) as { connected: boolean; events: unknown[] };
    expect(body).toMatchObject({ connected: false, events: [] });

    state.prefs = parseCalendarPrefs({ enabled: true, calendarIds: ["work"] });
    state.status = "denied";
    body = (await (await eventsRoute.GET(get(`/api/calendar/events?${DAY}`))).json()) as typeof body;
    expect(body).toMatchObject({ connected: false, events: [] });
  });

  it("refuses a malformed, reversed or too-long window", async () => {
    for (const q of ["from=nope&to=nope", "from=2026-11-28T00%3A00%3A00Z&to=2026-11-27T00%3A00%3A00Z", "from=2026-01-01T00%3A00%3A00Z&to=2026-03-01T00%3A00%3A00Z", "from=2026-11-27T00%3A00%3A00Z"]) {
      expect((await eventsRoute.GET(get(`/api/calendar/events?${q}`))).status, q).toBe(400);
    }
  });
});

describe("GET/PATCH /api/calendar (§3.1)", () => {
  it("lists the calendars and the prefs, dropping IDs this Mac does not know", async () => {
    const res = await calendarRoute.GET(get("/api/calendar"));
    const body = (await res.json()) as { status: string; calendars: { id: string }[]; prefs: { calendarIds: string[] } };
    expect(body.status).toBe("fullAccess");
    expect(body.calendars.map((c) => c.id)).toEqual(["work", "holidays"]);
    expect(body.prefs.calendarIds).toEqual(["work"]);
    // The route hands the Mac's calendar IDs to the prefs reader, not the other way round.
    expect(state.known).toEqual(["work", "holidays"]);
  });

  it("saves a valid patch and refuses unknown keys or bad values", async () => {
    const patch = (body: unknown) => calendarRoute.PATCH(new NextRequest("http://app.test/api/calendar", { method: "PATCH", body: JSON.stringify(body), headers: { "content-type": "application/json" } }));

    const ok = await patch({ hideDeclined: false, workStart: "07:00", workEnd: "17:00" });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ prefs: { hideDeclined: false, workStart: "07:00", workEnd: "17:00" } });
    expect(state.saved).toHaveLength(1);

    expect((await patch({ calendarIds: ["work"], surprise: true })).status).toBe(400);
    expect((await patch({ weekStart: "tuesday" })).status).toBe(400);
    expect((await patch({ workStart: "7am" })).status).toBe(400);
    expect(state.saved).toHaveLength(1);
  });
});
