"use client";

// A day's meetings on a time grid (CALENDAR-SPEC §3.2). All the placement is in
// `lib/calendar/layout.ts`; this file only draws it. The Planner (C2) will draw
// the same grid for a week, so it takes the day explicitly.
import { useMemo } from "react";
import { layoutDay, minutesToHhmm, type GridEvent } from "@/lib/calendar/layout";
import type { CalendarEventView } from "@/lib/calendar/types";

/** The most a minute may take on screen, and the height the window aims for. */
const MAX_PX_PER_MIN = 0.8;
const TARGET_HEIGHT = 460;

const EVENT_CLASS = "absolute min-w-0 overflow-hidden rounded-md border-l-2 px-1.5 py-0.5 text-left text-[11.5px] leading-tight hover:brightness-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus";

function blockStyle(event: CalendarEventView): React.CSSProperties {
  const color = /^#[0-9a-f]{6}$/i.test(event.calendarColor) ? event.calendarColor : "#7a7a7a";
  return { backgroundColor: `${color}1f`, borderLeftColor: color };
}

function EventBlock({ item, px, windowStart, onOpen }: { item: GridEvent; px: number; windowStart: number; onOpen: (event: CalendarEventView, el: HTMLElement) => void }) {
  const { event, startMin, endMin, column, columns } = item;
  const top = (startMin - windowStart) * px;
  const height = Math.max(18, (endMin - startMin) * px - 1);
  return (
    <button
      type="button"
      onClick={(e) => onOpen(event, e.currentTarget)}
      data-calendar-event={event.id}
      data-calendar-timed
      title={`${event.title} · ${minutesToHhmm(startMin)}–${minutesToHhmm(endMin)}`}
      className={`${EVENT_CLASS} text-fg`}
      style={{
        ...blockStyle(event),
        top,
        height,
        left: `${(column / columns) * 100}%`,
        width: `calc(${100 / columns}% - 2px)`,
      }}
    >
      <span className="block truncate font-medium">{event.title}</span>
      {height >= 30 && (
        <span className="block truncate text-[10.5px] text-muted">
          {minutesToHhmm(startMin)}–{minutesToHhmm(endMin)}
        </span>
      )}
    </button>
  );
}

export function CalendarDayGrid({
  events,
  day,
  tz,
  workStart,
  workEnd,
  hideDeclined,
  now,
  onOpen,
  emptyNote,
}: {
  events: readonly CalendarEventView[];
  day: string;
  tz: string;
  workStart: string;
  workEnd: string;
  hideDeclined: boolean;
  now: Date;
  onOpen: (event: CalendarEventView, el: HTMLElement) => void;
  emptyNote?: string;
}) {
  const layout = useMemo(
    () => layoutDay(events, day, { tz, workStart, workEnd, hideDeclined, now }),
    // The clock moves once a minute; the layout only needs the minute.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [events, day, tz, workStart, workEnd, hideDeclined, Math.floor(now.getTime() / 60_000)],
  );
  const span = Math.max(1, layout.windowEnd - layout.windowStart);
  const px = Math.max(0.35, Math.min(MAX_PX_PER_MIN, TARGET_HEIGHT / span));
  const height = span * px;
  const hours: number[] = [];
  for (let h = Math.ceil(layout.windowStart / 60); h <= Math.floor(layout.windowEnd / 60); h++) hours.push(h * 60);

  return (
    <div data-calendar-grid={day}>
      {layout.allDay.length > 0 && (
        <ul className="mb-2 space-y-1 border-b border-line-soft pb-2" aria-label="All-day events" data-calendar-all-day>
          {layout.allDay.map((event) => (
            <li key={`${event.id}:${day}`}>
              <button
                type="button"
                onClick={(e) => onOpen(event, e.currentTarget)}
                data-calendar-event={event.id}
                className="flex w-full min-w-0 items-center gap-1.5 rounded px-1 py-0.5 text-left text-[11.5px] hover:bg-hover"
              >
                <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ backgroundColor: blockStyle(event).borderLeftColor }} />
                <span className="truncate">{event.title}</span>
                <span className="ml-auto shrink-0 text-[10.5px] text-faint">All day</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="relative flex pl-10">
        <div className="relative min-w-0 flex-1" style={{ height }}>
          {hours.map((h) => (
            <div key={h} aria-hidden className="absolute inset-x-0 border-t border-line-soft" style={{ top: (h - layout.windowStart) * px }}>
              <span className="absolute -left-10 -top-1.5 w-9 text-right text-[10px] tabular-nums text-faint">{minutesToHhmm(h)}</span>
            </div>
          ))}
          {layout.timed.map((item) => (
            <EventBlock key={`${item.event.id}:${item.startMin}`} item={item} px={px} windowStart={layout.windowStart} onOpen={onOpen} />
          ))}
          {layout.nowMin != null && layout.nowMin >= layout.windowStart && layout.nowMin <= layout.windowEnd && (
            <div aria-hidden data-calendar-now className="pointer-events-none absolute inset-x-0 z-10 border-t border-critical" style={{ top: (layout.nowMin - layout.windowStart) * px }}>
              <span className="absolute -left-1 -top-[3px] size-1.5 rounded-full bg-critical" />
            </div>
          )}
          {layout.timed.length === 0 && emptyNote && (
            <p className="absolute inset-x-0 top-1/2 -translate-y-1/2 px-2 text-center text-[11.5px] text-faint" data-calendar-empty>
              {emptyNote}
            </p>
          )}
        </div>
      </div>
      <span className="sr-only">Meetings on {day}</span>
    </div>
  );
}
