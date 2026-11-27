"use client";

// Home → Calendar (CALENDAR-SPEC §3.2): today's meetings on a compact grid,
// the next meeting, and a read-only popover with Join and Open in Calendar.
// Nothing here edits a calendar; the panel only reads the server route.
import { useEffect, useRef, useState } from "react";
import { countMeetings, eventTimeLabel, eventZoneNote, nextMeeting } from "@/lib/calendar/layout";
import { addDays } from "@/lib/tasks/dates";
import type { CalendarEventView } from "@/lib/calendar/types";
import { Icon } from "../icons";
import { Popover, btn } from "../ui/popover";
import { connectCalendars, type CalendarFeed } from "./use-calendar";
import { CalendarDayGrid } from "./day-grid";

function dayLabel(day: string, today: string): string {
  if (day === today) return "Today";
  return "Tomorrow";
}

function tomorrowLine(n: number): string {
  return n === 0 ? "No meetings tomorrow" : `${n} meeting${n === 1 ? "" : "s"} tomorrow`;
}

function shortDate(day: string): string {
  // A calendar date, never shifted: format it in UTC like `longDate`.
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

function NextLine({ events, tz }: { events: readonly CalendarEventView[]; tz: string }) {
  const next = nextMeeting(events, new Date(), tz, false);
  const text =
    next.kind === "now"
      ? `Now: ${next.title} · until ${next.until}`
      : next.kind === "next"
        ? `Next: ${next.title} in ${next.minutes} min`
        : next.until
          ? `Free until ${next.until}`
          : "No more meetings today";
  return (
    <p className="truncate text-[12px] text-muted" data-calendar-next={next.kind} title={text}>
      {text}
    </p>
  );
}

function EventPopover({ event, anchor, onClose, tz }: { event: CalendarEventView; anchor: React.RefObject<HTMLElement | null>; onClose: () => void; tz: string }) {
  const zone = eventZoneNote(event, tz);
  const bridge = typeof window === "undefined" ? undefined : window.deska?.calendar;
  return (
    <Popover anchor={anchor} open onClose={onClose} width={300}>
      <div className="space-y-2 p-3.5 text-[12.5px]" data-calendar-popover>
        <p className="pr-4 font-semibold leading-snug">{event.title}</p>
        <p className="text-muted">
          <span data-calendar-popover-time>{eventTimeLabel(event, tz)}</span>
          {zone && <span className="text-faint"> · {zone}</span>}
        </p>
        <p className="flex items-center gap-1.5 text-muted">
          <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ backgroundColor: event.calendarColor }} />
          <span className="truncate" data-calendar-popover-calendar>
            {event.calendarTitle}
          </span>
        </p>
        {event.location && (
          <p className="break-words text-muted" data-calendar-popover-location>
            {event.location}
          </p>
        )}
        {event.attendeeCount > 0 && (
          <p className="flex items-center gap-1.5 text-muted" data-calendar-popover-attendees>
            <Icon name="users" size={12} className="shrink-0 text-faint" />
            {event.attendeeCount} {event.attendeeCount === 1 ? "person" : "people"}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2 border-t border-line-soft pt-2.5">
          {event.joinUrl && (
            <a
              href={event.joinUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={btn.primary}
              data-calendar-join
              onClick={onClose}
            >
              Join
            </a>
          )}
          {bridge && (
            <button type="button" className={btn.outline} data-calendar-open-app onClick={() => void bridge.openEvent(event.id).then(onClose, onClose)}>
              <Icon name="external" size={12} />
              Open in Calendar
            </button>
          )}
        </div>
      </div>
    </Popover>
  );
}

export function CalendarPanel({ feed, today, tz }: { feed: CalendarFeed; today: string; tz: string }) {
  const [day, setDay] = useState(today);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [open, setOpen] = useState<{ event: CalendarEventView; anchor: HTMLElement } | null>(null);
  const anchor = useRef<HTMLElement | null>(null);

  // A new day starts at midnight: the panel goes back to Today.
  useEffect(() => setDay(today), [today]);

  const data = feed.data;
  const status = data?.status;
  const connected = data?.connected === true;
  const denied = status === "denied" || status === "restricted";
  const unavailable = status === "unavailable";
  const events = data?.events ?? [];
  const tomorrow = addDays(today, 1);
  const meetingsToday = countMeetings(events, today, tz);

  async function connect() {
    setBusy(true);
    setNote(null);
    try {
      const status = await connectCalendars();
      if (status === "denied" || status === "restricted") setNote("Calendar access was not granted.");
      else if (status === "notDetermined") setNote("Allow Calendars for Deska in System Settings, then try again.");
      else if (status === "writeOnly") setNote("Deska has write-only access. Choose Full Access in System Settings → Privacy & Security → Calendars.");
      else if (status !== "fullAccess") setNote("Deska could not reach macOS Calendar. Try again.");
      feed.refresh();
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Could not connect calendars.");
    } finally {
      setBusy(false);
    }
  }

  const title = dayLabel(day, today);
  return (
    <section aria-label="Calendar" data-home-panel="calendar" data-calendar-state={connected ? "connected" : denied ? "denied" : unavailable ? "unavailable" : "not-connected"} className="min-w-0 overflow-hidden rounded-xl border border-line bg-surface shadow-raised">
      <header className="flex min-h-10 items-center gap-2 border-b border-line px-4 py-1.5">
        <h2 className="min-w-0 truncate text-[13.5px] font-semibold">{title}</h2>
        <span className="min-w-0 truncate text-[12px] text-faint" data-calendar-date>
          {shortDate(day)}
        </span>
        {!denied && !unavailable && (
          <span className="ml-auto flex shrink-0 items-center gap-0.5">
            <button type="button" onClick={() => setDay(today)} disabled={day === today} aria-label="Previous day" className="grid size-6 place-items-center rounded text-faint hover:bg-hover hover:text-fg disabled:opacity-30 disabled:hover:bg-transparent">
              <Icon name="chevronLeft" size={13} />
            </button>
            <button type="button" onClick={() => setDay(tomorrow)} disabled={day === tomorrow} aria-label="Next day" className="grid size-6 place-items-center rounded text-faint hover:bg-hover hover:text-fg disabled:opacity-30 disabled:hover:bg-transparent">
              <Icon name="chevronRight" size={13} />
            </button>
          </span>
        )}
      </header>

      {denied ? (
        <div className="space-y-2 px-4 py-4 text-[12.5px]">
          <p className="font-medium">Deska can’t read your calendars</p>
          <p className="text-muted">macOS has not given Deska access to Calendars.</p>
          {typeof window !== "undefined" && window.deska?.calendar ? (
            <button type="button" className={btn.outline} onClick={() => void window.deska?.calendar?.openSettings()}>
              Open System Settings
            </button>
          ) : (
            <p className="text-faint">Open System Settings → Privacy &amp; Security → Calendars and allow Deska.</p>
          )}
        </div>
      ) : unavailable ? (
        <div className="px-4 py-4 text-[12.5px]">
          <p className="font-medium">See your meetings here</p>
          <p className="mt-1 text-muted">Calendar access is available in the Deska desktop app.</p>
        </div>
      ) : !data && feed.error ? (
        // The first read failed: say so instead of waiting forever (§3.3).
        <div className="space-y-2 px-4 py-4 text-[12.5px]" data-calendar-error>
          <p className="font-medium">Couldn’t read your calendar</p>
          <button type="button" className={btn.outline} onClick={feed.refresh}>
            Try again
          </button>
        </div>
      ) : !connected && (feed.loading || !data) ? (
        <p className="px-4 py-6 text-center text-[12.5px] text-faint">Reading your calendar…</p>
      ) : !connected ? (
        <div className="space-y-2 px-4 py-4 text-[12.5px]">
          <p className="font-medium">See your meetings here</p>
          <p className="text-muted">Read the calendars already in Calendar.app. Nothing is uploaded.</p>
          <button type="button" className={btn.outline} onClick={() => void connect()} disabled={busy} data-calendar-connect>
            {busy ? "Connecting…" : "Connect calendars"}
          </button>
          {note && <p className="text-critical">{note}</p>}
        </div>
      ) : feed.loading ? (
        <p className="px-4 py-6 text-center text-[12.5px] text-faint">Reading your calendar…</p>
      ) : (
        <div className="px-4 py-2.5">
          {day === today ? <NextLine events={events} tz={tz} /> : <p className="text-[12px] text-muted">{tomorrowLine(countMeetings(events, day, tz))}</p>}
          {feed.error && (
            <p className="mt-1 text-[11.5px] text-critical" data-calendar-stale>
              Couldn’t refresh · showing the last read
            </p>
          )}
          <div className="mt-2">
            <CalendarDayGrid
              events={events}
              day={day}
              tz={tz}
              workStart={data?.prefs.workStart ?? "08:00"}
              workEnd={data?.prefs.workEnd ?? "18:00"}
              hideDeclined={false}
              now={new Date()}
              emptyNote={day === today ? "No meetings today" : "Nothing tomorrow"}
              onOpen={(event, el) => {
                anchor.current = el;
                setOpen({ event, anchor: el });
              }}
            />
          </div>
        </div>
      )}

      {open && (
        <EventPopover
          event={open.event}
          anchor={anchor}
          tz={tz}
          onClose={() => {
            setOpen(null);
            anchor.current = null;
          }}
        />
      )}
      {/* The count is also read by Home's context line; keep the calculation in one place. */}
      <span className="sr-only" data-calendar-count>
        {meetingsToday}
      </span>
    </section>
  );
}
