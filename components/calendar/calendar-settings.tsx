"use client";

// Settings → Calendar (CALENDAR-SPEC §3.1): the one permission click, the
// calendars to show, and the drawing rules. Reading stays on this Mac; prefs
// are one `app_settings` value and travel with backups.
import { useCallback, useEffect, useMemo, useState } from "react";
import type { CalendarInfo } from "@/lib/calendar/types";
import { Icon } from "../icons";
import { connectCalendars, readCalendarSettings, saveCalendarSettings, type CalendarSettingsView } from "./use-calendar";

const field = "h-8 rounded-md border border-line bg-surface px-2 text-[12.5px] outline-none focus:border-focus";

export function CalendarSettings() {
  const [view, setView] = useState<CalendarSettingsView | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [openSettings, setOpenSettings] = useState(false);

  const load = useCallback(async () => {
    try {
      setView(await readCalendarSettings());
    } catch (e) {
      setMessage({ kind: "error", text: e instanceof Error ? e.message : String(e) });
    }
  }, []);
  useEffect(() => void load(), [load]);

  async function run(fn: () => Promise<string | void>) {
    setBusy(true);
    setMessage(null);
    try {
      const text = await fn();
      if (text) setMessage({ kind: "ok", text });
    } catch (e) {
      setMessage({ kind: "error", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  const save = (patch: Parameters<typeof saveCalendarSettings>[0]) =>
    run(async () => {
      const { prefs } = await saveCalendarSettings(patch);
      setView((v) => (v ? { ...v, prefs } : v));
    });

  const grouped = useMemo(() => {
    const groups = new Map<string, CalendarInfo[]>();
    for (const c of view?.calendars ?? []) {
      const key = c.source || "Calendars";
      groups.set(key, [...(groups.get(key) ?? []), c]);
    }
    return [...groups.entries()];
  }, [view]);

  const status = view?.status;
  const prefs = view?.prefs;
  const granted = status === "fullAccess";
  // Reading was on, but macOS asks again (after an update) or gave write-only access.
  const lostAccess = prefs?.enabled === true && !granted;
  const denied = status === "denied" || status === "restricted";
  const unavailable = status === "unavailable";

  return (
    <section aria-labelledby="calendar-h" className="space-y-3" data-calendar-settings>
      <h2 id="calendar-h" className="text-[15px] font-semibold">
        Calendar
      </h2>
      <div className="space-y-3 rounded-lg border border-line p-4 text-[13px]">
        {unavailable ? (
          <p className="text-muted">Calendar access needs the Deska desktop app.</p>
        ) : denied ? (
          <div className="space-y-2">
            <p className="font-medium">Deska can’t read your calendars</p>
            <p className="text-[12px] text-muted">macOS has not given Deska access to Calendars.</p>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                const bridge = window.deska?.calendar;
                if (bridge) void bridge.openSettings();
                setOpenSettings(true);
              }}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line px-3 font-medium hover:bg-hover">
              Open System Settings
            </button>
            {openSettings && (
              <p className="text-[12px] text-faint">Open System Settings → Privacy &amp; Security → Calendars and allow Deska, then come back to Settings.</p>
            )}
          </div>
        ) : !prefs?.enabled || !granted ? (
          <div className="space-y-2">
            <p className="font-medium">Meetings next to your tasks</p>
            <p className="text-[12px] text-muted">
              {lostAccess
                ? "macOS needs to allow Calendars for Deska again; this can happen after an update. Your calendar choices are kept."
                : "Deska reads the calendars already in Calendar.app (Google, iCloud, Exchange). Nothing is uploaded and no event is stored."}
            </p>
            <button
              type="button"
              disabled={busy}
              data-calendar-settings-connect
              onClick={() =>
                void run(async () => {
                  const answer = await connectCalendars();
                  await load();
                  if (answer === "denied" || answer === "restricted") return "macOS did not allow access.";
                  if (answer === "notDetermined") return "Allow Calendars for Deska in System Settings, then try again.";
                  if (answer === "writeOnly") return "Deska has write-only access. Choose Full Access for Deska in System Settings → Privacy & Security → Calendars.";
                  if (answer !== "fullAccess") return "Deska could not reach macOS Calendar. Try again.";
                  return "Calendars connected.";
                })
              }
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-brand px-3 font-medium text-on-brand hover:opacity-90 disabled:opacity-60"
            >
              Connect calendars
            </button>
          </div>
        ) : (
          <>
            <div className="space-y-1.5">
              <p className="font-medium">Calendars to show</p>
              {grouped.length === 0 ? (
                <p className="text-[12px] text-muted">Calendar.app has no calendars Deska can read.</p>
              ) : (
                grouped.map(([source, calendars]) => (
                  <fieldset key={source} className="space-y-1">
                    <legend className="text-[11.5px] font-medium uppercase tracking-wide text-faint">{source}</legend>
                    {calendars.map((c) => (
                      <label key={c.id} className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={prefs.calendarIds.includes(c.id)}
                          // One save at a time: each sends the whole list.
                          disabled={busy}
                          onChange={() => void save({ calendarIds: prefs.calendarIds.includes(c.id) ? prefs.calendarIds.filter((id) => id !== c.id) : [...prefs.calendarIds, c.id] })}
                          aria-label={`Show ${c.title}`}
                        />
                        <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: c.color }} />
                        <span className="min-w-0 truncate">{c.title}</span>
                        {c.subscribed && <span className="text-[11px] text-faint">subscribed</span>}
                      </label>
                    ))}
                  </fieldset>
                ))
              )}
              <p className="text-[11.5px] text-faint">Subscribed holiday and birthday calendars start turned off.</p>
            </div>

            <div className="space-y-2 border-t border-line pt-2">
              <label className="flex items-center gap-3">
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">Hide declined events</span>
                  <span className="block text-[12px] text-muted">Leave out meetings you said no to.</span>
                </span>
                <input type="checkbox" checked={prefs.hideDeclined} onChange={(e) => void save({ hideDeclined: e.target.checked })} aria-label="Hide declined events" />
              </label>
              <label className="flex items-center gap-3 border-t border-line-soft pt-2">
                <span className="min-w-0 flex-1 font-medium">Week starts on</span>
                <select value={prefs.weekStart} onChange={(e) => void save({ weekStart: e.target.value === "sunday" ? "sunday" : "monday" })} aria-label="Week starts on" className={field}>
                  <option value="monday">Monday</option>
                  <option value="sunday">Sunday</option>
                </select>
              </label>
              <div className="flex flex-wrap items-center gap-3 border-t border-line-soft pt-2">
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">Working hours</span>
                  <span className="block text-[12px] text-muted">The grid opens on this range and grows for earlier or later meetings.</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <input type="time" value={prefs.workStart} aria-label="Work day starts" className={field} onChange={(e) => e.target.value && void save({ workStart: e.target.value })} />
                  <span className="text-faint">–</span>
                  <input type="time" value={prefs.workEnd} aria-label="Work day ends" className={field} onChange={(e) => e.target.value && void save({ workEnd: e.target.value })} />
                </span>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-line pt-2">
              <p className="text-[11.5px] text-faint">Calendar choices belong to this Mac; a backup from another Mac drops unknown ones.</p>
              <button type="button" disabled={busy} onClick={() => void save({ enabled: false, calendarIds: [] })} className="shrink-0 rounded px-1.5 py-0.5 text-[12px] text-muted hover:bg-hover hover:text-fg">
                Disconnect
              </button>
            </div>
          </>
        )}
        {message && <p className={message.kind === "error" ? "text-[12px] text-critical" : "text-[12px] text-muted"} data-calendar-settings-message>{message.text}</p>}
        {granted && !prefs?.enabled && <p className="text-[11.5px] text-faint">macOS access is already allowed; connecting only turns reading on.</p>}
      </div>
      {granted && <p className="flex items-center gap-1.5 text-[11.5px] text-faint"><Icon name="calendar" size={12} /> After an update, macOS may ask again because the app is signed ad hoc.</p>}
    </section>
  );
}
