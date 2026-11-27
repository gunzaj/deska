"use client";

// The calendar feed (CALENDAR-SPEC §3.2, §3.3): one read from the server route,
// refreshed on load, on window focus, every 5 minutes and when Calendar.app or
// a sync changes something. A failed read keeps the last result and marks it
// stale; an error is never drawn as an empty day (§3.3).
import { useCallback, useEffect, useRef, useState } from "react";
import type { CalendarEventsResponse, CalendarReadStatus } from "@/lib/calendar/types";
import { defaultCalendarIds, type CalendarPrefs } from "@/lib/calendar/settings";
import type { CalendarInfo } from "@/lib/calendar/types";
import { addDays, zonedToUtc } from "@/lib/tasks/dates";

/** How often an open page re-reads the calendar. */
export const CALENDAR_REFRESH_MS = 5 * 60_000;

export type CalendarFeed = {
  data: CalendarEventsResponse | null;
  /** The first read is in flight (the panel shows a placeholder). */
  loading: boolean;
  /** The last read failed; `data` is still the previous result. */
  error: boolean;
  refresh: () => void;
};

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(typeof body.error === "string" ? body.error : `Request failed (${res.status})`);
  return body as T;
}

/**
 * Today and tomorrow, in the viewer's zone. The Home panel only steps between
 * the two (§3.2), so one read covers both and a change of day is instant.
 */
export function useCalendar(today: string, tz: string): CalendarFeed {
  const [data, setData] = useState<CalendarEventsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const generation = useRef(0);

  const load = useCallback(async () => {
    const mine = ++generation.current;
    const from = zonedToUtc(today, "00:00", tz).toISOString();
    const to = zonedToUtc(addDays(today, 2), "00:00", tz).toISOString();
    try {
      const next = await api<CalendarEventsResponse>(`/api/calendar/events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
      if (mine !== generation.current) return;
      setData(next);
      setError(false);
    } catch {
      if (mine !== generation.current) return;
      setError(true);
    } finally {
      if (mine === generation.current) setLoading(false);
    }
  }, [today, tz]);

  useEffect(() => {
    setLoading(data == null);
    void load();
    const timer = setInterval(() => void load(), CALENDAR_REFRESH_MS);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    // No data crosses the bridge: this only says "read again" (§3.3).
    const off = window.deska?.calendar?.onChanged(() => void load());
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      off?.();
    };
    // `data` only decides the first-load placeholder.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  return { data, loading, error, refresh: () => void load() };
}

export type CalendarSettingsView = { status: CalendarReadStatus; calendars: CalendarInfo[]; prefs: CalendarPrefs };

/** `GET /api/calendar`: the permission, the calendars and the saved prefs (§3.1). */
export function readCalendarSettings(): Promise<CalendarSettingsView> {
  return api<CalendarSettingsView>("/api/calendar");
}

/** Save prefs; the server validates and returns the stored value. */
export function saveCalendarSettings(patch: Partial<CalendarPrefs>): Promise<{ prefs: CalendarPrefs }> {
  return api<{ prefs: CalendarPrefs }>("/api/calendar", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
}

/**
 * "Connect calendars" (§3.1): the one click that may show the macOS prompt.
 * After access, reading is turned on for every calendar except subscribed
 * holiday and birthday ones. Returns macOS's answer.
 */
export async function connectCalendars(): Promise<CalendarReadStatus> {
  const bridge = window.deska?.calendar;
  const status = bridge ? await bridge.connect() : (await readCalendarSettings()).status;
  if (status !== "fullAccess" && status !== "writeOnly") return status;
  const view = await readCalendarSettings();
  // Keep a choice the user already made; first connect picks the defaults.
  if (!view.prefs.enabled || view.prefs.calendarIds.length === 0) {
    await saveCalendarSettings({ enabled: true, calendarIds: defaultCalendarIds(view.calendars) });
  } else {
    await saveCalendarSettings({ enabled: true });
  }
  return status;
}
