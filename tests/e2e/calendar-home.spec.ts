import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { as, resetSharedSettings } from "./helpers";

// HOME-SPEC §3.2 + CALENDAR-SPEC §3.2, §3.5: the Home Calendar panel with
// fixture events. The API is answered here, so the spec never needs the macOS
// helper and the fictional events are made relative to today.
test.beforeEach(async ({ request }) => {
  await resetSharedSettings(request);
  await setTasksOnly(request, false);
});
test.afterEach(async ({ request }) => {
  await setTasksOnly(request, false);
  await resetSharedSettings(request);
});

const setTasksOnly = (request: APIRequestContext, tasksOnly: boolean) =>
  request.post("/api/settings/mode", { headers: { "x-e2e-login": "alice" }, data: { tasksOnly } });

const todayAt = (hours: number, minutes = 0): Date => {
  const d = new Date();
  d.setHours(hours, minutes, 0, 0);
  return d;
};
const inMinutes = (minutes: number): Date => new Date(Date.now() + minutes * 60_000);

type Ev = {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay?: boolean;
  location?: string | null;
  attendeeCount?: number;
  joinUrl?: string | null;
  myStatus?: string | null;
};

const event = (e: Ev) => ({
  calendarId: "work",
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
  ...e,
});

const prefs = { hideDeclined: true, weekStart: "monday", workStart: "08:00", workEnd: "18:00" };

function feed(events: Ev[], over: Record<string, unknown> = {}) {
  return {
    status: "fullAccess",
    connected: true,
    calendars: [{ id: "work", title: "Work", color: "#3366cc" }],
    events: events.map(event),
    readAt: new Date().toISOString(),
    prefs,
    ...over,
  };
}

/** Answer the events read from `body()`, so a test can change it between reads. */
function mockFeed(page: Page, body: () => unknown) {
  return page.route("**/api/calendar/events**", (route) => route.fulfill({ json: body() }));
}

test("Home shows today's meetings in order, the all-day band, the next line and the context count", async ({ browser }) => {
  const { context, page } = await as(browser);
  const midnight = todayAt(0);
  const tomorrow = todayAt(0);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const events: Ev[] = [
    { id: "all-day", title: "Company offsite", start: midnight.toISOString(), end: tomorrow.toISOString(), allDay: true },
    { id: "first", title: "Design review", start: inMinutes(30).toISOString(), end: inMinutes(60).toISOString() },
    { id: "second", title: "Pairing", start: inMinutes(90).toISOString(), end: inMinutes(150).toISOString() },
  ];
  await mockFeed(page, () => feed(events));
  await page.goto("/home");

  const panel = page.locator('[data-home-panel="calendar"]');
  await expect(panel).toHaveAttribute("data-calendar-state", "connected");
  await expect(panel.locator("[data-calendar-all-day]")).toContainText("Company offsite");
  await expect(panel.locator("[data-calendar-timed]")).toHaveText([/Design review/, /Pairing/]);
  await expect(panel.locator("[data-calendar-next]")).toContainText("Next: Design review in");
  await expect(page.locator("[data-home-context]")).toContainText("2 meetings today");
  await context.close();
});

test("an event opens a read-only popover with Join and Open in Calendar", async ({ browser }) => {
  const { context, page } = await as(browser);
  await page.addInitScript(() => {
    (window as unknown as { __opened: string[] }).__opened = [];
    window.deska = {
      openExternal: async () => true,
      calendar: {
        status: async () => "fullAccess",
        connect: async () => "fullAccess",
        openEvent: async (id: string) => {
          (window as unknown as { __opened: string[] }).__opened.push(id);
          return true;
        },
        openSettings: async () => {},
        onChanged: () => () => {},
      },
    } as unknown as typeof window.deska;
  });
  const start = todayAt(10);
  const end = todayAt(11);
  await mockFeed(page, () =>
    feed([
      {
        id: "evt-1",
        title: "Design review",
        start: start.toISOString(),
        end: end.toISOString(),
        location: "Room 2 · https://acme.zoom.us/j/123",
        attendeeCount: 3,
        joinUrl: "https://acme.zoom.us/j/123",
      },
    ]),
  );
  await page.goto("/home");
  await page.locator("[data-calendar-timed]").first().click();

  const popover = page.locator("[data-calendar-popover]");
  await expect(popover).toBeVisible();
  await expect(popover).toContainText("Design review");
  await expect(popover).toContainText("10:00–11:00");
  await expect(popover.locator("[data-calendar-popover-calendar]")).toHaveText("Work");
  await expect(popover.locator("[data-calendar-popover-location]")).toContainText("Room 2");
  await expect(popover.locator("[data-calendar-popover-attendees]")).toContainText("3 people");
  await expect(popover.locator("[data-calendar-join]")).toHaveAttribute("href", "https://acme.zoom.us/j/123");

  await popover.locator("[data-calendar-open-app]").click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __opened: string[] }).__opened)).toEqual(["evt-1"]);
  await context.close();
});

test("connecting from the panel turns reading on with the default calendars", async ({ browser }) => {
  const { context, page } = await as(browser);
  let connected = false;
  await mockFeed(page, () => (connected ? feed([{ id: "a", title: "Standup", start: todayAt(9).toISOString(), end: todayAt(9, 15).toISOString() }]) : feed([], { connected: false, status: "notDetermined", calendars: [] })));
  await page.route("**/api/calendar", async (route) => {
    if (route.request().method() === "PATCH") {
      connected = true;
      await route.fulfill({ json: { prefs: { enabled: true, calendarIds: ["work"], hideDeclined: true, weekStart: "monday", workStart: "08:00", workEnd: "18:00" } } });
      return;
    }
    await route.fulfill({
      json: {
        status: "fullAccess",
        calendars: [{ id: "work", title: "Work", color: "#3366cc", source: "iCloud", allowsWrite: true, subscribed: false, birthday: false }],
        prefs: { enabled: false, calendarIds: [], hideDeclined: true, weekStart: "monday", workStart: "08:00", workEnd: "18:00" },
      },
    });
  });

  await page.goto("/home");
  const panel = page.locator('[data-home-panel="calendar"]');
  await expect(panel).toHaveAttribute("data-calendar-state", "not-connected");
  await expect(panel).toContainText("See your meetings here");
  await panel.locator("[data-calendar-connect]").click();
  await expect(panel).toHaveAttribute("data-calendar-state", "connected");
  await expect(panel).toContainText("Standup");
  await context.close();
});

test("denied access explains where to allow it; the arrows step to tomorrow", async ({ browser }) => {
  const { context, page } = await as(browser);
  await mockFeed(page, () => feed([], { connected: false, status: "denied", calendars: [] }));
  await page.goto("/home");
  const panel = page.locator('[data-home-panel="calendar"]');
  await expect(panel).toHaveAttribute("data-calendar-state", "denied");
  await expect(panel).toContainText("Deska can’t read your calendars");
  await expect(panel).toContainText("System Settings");

  const tomorrow = todayAt(0);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const later = new Date(tomorrow);
  later.setHours(9, 0, 0, 0);
  const laterEnd = new Date(later.getTime() + 30 * 60_000);
  await mockFeed(page, () => feed([{ id: "tm", title: "Retro", start: later.toISOString(), end: laterEnd.toISOString() }]));
  await page.goto("/home");
  await panel.getByRole("button", { name: "Next day" }).click();
  await expect(panel.getByRole("heading", { name: "Tomorrow" })).toBeVisible();
  await expect(panel.locator("[data-calendar-timed]")).toContainText("Retro");
  await panel.getByRole("button", { name: "Previous day" }).click();
  await expect(panel.getByRole("heading", { name: "Today" })).toBeVisible();
  await context.close();
});

test("Settings → Calendar lists the calendars and saves each change", async ({ browser }) => {
  const { context, page } = await as(browser);
  const prefs = { enabled: true, calendarIds: ["work"], hideDeclined: true, weekStart: "monday", workStart: "08:00", workEnd: "18:00" };
  const patches: Record<string, unknown>[] = [];
  await page.route("**/api/calendar", async (route) => {
    if (route.request().method() !== "PATCH") {
      await route.fulfill({
        json: {
          status: "fullAccess",
          calendars: [
            { id: "work", title: "Work", color: "#3366cc", source: "iCloud", allowsWrite: true, subscribed: false, birthday: false },
            { id: "holidays", title: "Holidays", color: "#cc3333", source: "iCloud", allowsWrite: false, subscribed: true, birthday: false },
          ],
          prefs,
        },
      });
      return;
    }
    const patch = route.request().postDataJSON() as Record<string, unknown>;
    patches.push(patch);
    Object.assign(prefs, patch);
    await route.fulfill({ json: { prefs } });
  });

  await page.goto("/settings");
  const section = page.locator("[data-calendar-settings]");
  await expect(section.getByRole("checkbox", { name: "Show Work" })).toBeChecked();
  await expect(section.getByRole("checkbox", { name: "Show Holidays" })).not.toBeChecked();
  await expect(section.getByRole("checkbox", { name: "Hide declined events" })).toBeChecked();

  const holidays = section.getByRole("checkbox", { name: "Show Holidays" });
  await holidays.click();
  await expect(holidays).toBeChecked();
  await expect.poll(() => patches).toContainEqual({ calendarIds: ["work", "holidays"] });
  await section.getByRole("combobox", { name: "Week starts on" }).selectOption("sunday");
  await expect.poll(() => patches).toContainEqual({ weekStart: "sunday" });

  await section.getByRole("button", { name: "Disconnect" }).click();
  await expect.poll(() => patches).toContainEqual({ enabled: false, calendarIds: [] });
  await expect(section.getByRole("button", { name: "Connect calendars" })).toBeVisible();
  await context.close();
});

test("tasks-only mode shows the Calendar panel", async ({ browser, request }) => {
  await setTasksOnly(request, true);
  const { context, page } = await as(browser);
  await mockFeed(page, () => feed([{ id: "a", title: "Standup", start: todayAt(9).toISOString(), end: todayAt(9, 15).toISOString() }]));
  await page.goto("/home");
  await expect(page.locator('[data-home-panel="calendar"]')).toContainText("Standup");
  await context.close();
});
