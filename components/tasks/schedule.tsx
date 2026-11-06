"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import { zonedToUtc } from "@/lib/tasks/dates";
import type { Recurrence, ReminderInput, Task } from "@/lib/tasks/model";
import { parseQuickAdd, weekday } from "@/lib/tasks/quick-add";
import { describeRule, firstOccurrence, formatRule, nextOccurrence, ordinal, parseRule, type Rule } from "@/lib/tasks/recurrence";
import { Icon } from "../icons";
import { btn, Popover } from "../ui/popover";

// Recurrence and reminders on the task panel (SPEC §12.5, §12.6).

const ONLY_RECURRENCE = new Set(["recurrence"] as const);
const BYDAY = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const WEEK = [1, 2, 3, 4, 5, 6, 0];
const field = "h-7 rounded-md border border-line bg-surface px-2 text-[12.5px] text-fg outline-none focus:border-[var(--focus)]";

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const dayName = (wd: number, style: "long" | "short" = "long") =>
  new Date(Date.UTC(2026, 0, 4 + wd)).toLocaleDateString("en-GB", { weekday: style, timeZone: "UTC" });
const shortDate = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

/** Enter in the picker's fields must not reach the quick-add form it may sit in (React bubbles through portals). */
function onEnter(e: KeyboardEvent<HTMLElement>, run: () => void) {
  if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
  e.preventDefault();
  e.stopPropagation();
  run();
}

/**
 * Repeat button next to the due date (SPEC §12.5): presets for the due date's
 * day, a custom builder (every 2 weeks on Tue and Fri…), or quick-add words.
 * `firstDate` is the first occurrence on or after the due date (or today).
 */
export function RepeatPicker({
  value,
  dueDate,
  today,
  onChange,
}: {
  value: Recurrence | null;
  dueDate: string | null;
  today: string;
  onChange: (r: Recurrence | null, firstDate: string | null) => void;
}) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState(false);
  const base = dueDate ?? today;
  const close = () => {
    setOpen(false);
    setCustom(false);
  };
  const pick = (rule: string, fromCompletion: boolean, text = describeRule(rule, fromCompletion)) => {
    if (!text) return;
    onChange({ rule, text, fromCompletion }, firstOccurrence(rule, base));
    close();
  };
  return (
    <>
      <button
        ref={anchor}
        type="button"
        onClick={() => setOpen(true)}
        className={`${btn.ghost} ${value ? "text-fg" : ""}`}
        aria-label={value ? `Repeats ${value.text}` : "Set repeat"}
        title={value ? `Repeats ${value.text}` : "Repeat"}
      >
        <Icon name="repeat" size={13} />
        {value ? value.text : "Repeat"}
      </button>
      <Popover anchor={anchor} open={open} onClose={close} width={300}>
        {custom ? (
          <CustomRepeat value={value} base={base} onSave={pick} onBack={() => setCustom(false)} />
        ) : (
          <RepeatMenu
            value={value}
            base={base}
            today={today}
            onPick={pick}
            onNone={() => {
              if (value) onChange(null, null);
              close();
            }}
            onCustom={() => setCustom(true)}
          />
        )}
      </Popover>
    </>
  );
}

function RepeatMenu({
  value,
  base,
  today,
  onPick,
  onNone,
  onCustom,
}: {
  value: Recurrence | null;
  base: string;
  today: string;
  onPick: (rule: string, fromCompletion: boolean, text?: string) => void;
  onNone: () => void;
  onCustom: () => void;
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState(false);
  const wd = weekday(base);
  const day = Number(base.slice(8, 10));
  const presets = [
    { rule: "FREQ=DAILY", label: "Every day" },
    { rule: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR", label: "Every weekday", hint: "Mon–Fri" },
    { rule: `FREQ=WEEKLY;BYDAY=${BYDAY[wd]}`, label: `Every week on ${dayName(wd)}` },
    { rule: `FREQ=MONTHLY;BYMONTHDAY=${day}`, label: `Every month on the ${day === 31 ? "last day" : ordinal(day)}` },
    { rule: "FREQ=YEARLY", label: "Every year", hint: new Date(`${base}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }) },
  ];
  const isPreset = presets.some((p) => p.rule === value?.rule && !value.fromCompletion);
  const typed = () => {
    const raw = text.trim();
    if (!raw) return;
    const p = parseQuickAdd(raw.startsWith("every") || /^(daily|weekly|monthly|yearly)$/i.test(raw) ? raw : `every ${raw}`, { today, enabled: ONLY_RECURRENCE });
    if (!p.recurrence) return setError(true);
    onPick(p.recurrence.rule, p.recurrence.fromCompletion, p.recurrence.label);
  };
  const item = "flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] hover:bg-hover";
  const check = (on: boolean) => <Icon name="check" size={13} className={on ? "text-brand-text" : "invisible"} />;
  return (
    <div className="flex min-h-0 flex-col">
      <div className="border-b border-line px-3 py-2">
        <input
          autoFocus
          aria-label="Type a repeat rule"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setError(false);
          }}
          onKeyDown={(e) => onEnter(e, typed)}
          placeholder="Type, e.g. every other friday"
          className="h-7 w-full bg-transparent text-[13px] outline-none placeholder:text-faint"
        />
        {error && <p className="text-[11.5px] text-critical">Try “every monday”, “every 2 weeks” or “every! 3 days”</p>}
      </div>
      <div className="min-h-0 overflow-y-auto p-1" role="group" aria-label="Repeat options">
        <button type="button" onClick={onNone} className={item}>
          {check(!value)}
          <span className="flex-1">Doesn&apos;t repeat</span>
        </button>
        {presets.map((p) => (
          <button key={p.rule} type="button" onClick={() => onPick(p.rule, false)} className={item}>
            {check(value?.rule === p.rule && !value.fromCompletion)}
            <span className="min-w-0 flex-1 truncate">{p.label}</span>
            {p.hint && <span className="shrink-0 text-[11.5px] text-faint">{p.hint}</span>}
          </button>
        ))}
        <div className="my-1 border-t border-line" />
        <button type="button" onClick={onCustom} className={item}>
          {check(Boolean(value) && !isPreset)}
          <span className="min-w-0 flex-1 truncate">{value && !isPreset ? capital(value.text) : "Custom…"}</span>
          <span className="shrink-0 text-[11.5px] text-faint">{value && !isPreset ? "Edit" : ""}</span>
          <Icon name="chevronRight" size={13} className="text-faint" />
        </button>
      </div>
    </div>
  );
}

type Freq = Rule["freq"];
const UNITS: { freq: Freq; one: string }[] = [
  { freq: "DAILY", one: "day" },
  { freq: "WEEKLY", one: "week" },
  { freq: "MONTHLY", one: "month" },
  { freq: "YEARLY", one: "year" },
];

/** Every N days/weeks/months/years, on chosen weekdays or a day of the month. */
function CustomRepeat({
  value,
  base,
  onSave,
  onBack,
}: {
  value: Recurrence | null;
  base: string;
  onSave: (rule: string, fromCompletion: boolean) => void;
  onBack: () => void;
}) {
  const init = (value && parseRule(value.rule)) || { freq: "WEEKLY" as Freq, interval: 1, byDay: [weekday(base)], byMonthDay: null };
  const [freq, setFreq] = useState<Freq>(init.freq);
  const [count, setCount] = useState(String(init.interval));
  // Quick add's "every weekday" and "every friday" are weekly rules too.
  const [days, setDays] = useState<number[]>(init.byDay.length ? init.byDay : [weekday(base)]);
  const [monthDay, setMonthDay] = useState(init.byMonthDay ?? Number(base.slice(8, 10)));
  const [fromCompletion, setFromCompletion] = useState(value?.fromCompletion ?? false);

  const n = Math.min(999, Math.max(1, Math.floor(Number(count)) || 1));
  // From completion, a month counts from the day it's done, so no fixed day.
  const rule = formatRule({ freq, interval: n, byDay: freq === "WEEKLY" ? days : [], byMonthDay: freq === "MONTHLY" && !fromCompletion ? monthDay : null });
  const label = describeRule(rule, fromCompletion) ?? "";
  const first = firstOccurrence(rule, base);
  const upcoming = [first];
  while (upcoming.length < 3) upcoming.push(nextOccurrence(rule, upcoming[upcoming.length - 1]!) ?? first);
  const save = () => onSave(rule, fromCompletion);
  const toggle = (d: number) => setDays((ds) => (ds.includes(d) ? (ds.length > 1 ? ds.filter((x) => x !== d) : ds) : [...ds, d]));

  return (
    <div className="space-y-3 p-3 text-[13px]" aria-label="Custom repeat" role="group">
      <div className="flex items-center gap-1">
        <button type="button" onClick={onBack} className={btn.icon} aria-label="Back to repeat options">
          <Icon name="chevronLeft" size={14} />
        </button>
        <p className="font-semibold">Custom repeat</p>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-muted">Every</span>
        <input
          autoFocus
          type="number"
          inputMode="numeric"
          min={1}
          max={999}
          aria-label="Repeat interval"
          value={count}
          onChange={(e) => setCount(e.target.value)}
          onBlur={() => setCount(String(n))}
          onKeyDown={(e) => onEnter(e, save)}
          className={`${field} w-16`}
        />
        <select aria-label="Repeat unit" value={freq} onChange={(e) => setFreq(e.target.value as Freq)} className={field}>
          {UNITS.map((u) => (
            <option key={u.freq} value={u.freq}>
              {n === 1 ? u.one : `${u.one}s`}
            </option>
          ))}
        </select>
      </div>
      {freq === "WEEKLY" && (
        <div className="flex items-center gap-1" role="group" aria-label="On days">
          {WEEK.map((d) => {
            const on = days.includes(d);
            return (
              <button
                key={d}
                type="button"
                aria-pressed={on}
                aria-label={dayName(d)}
                title={dayName(d)}
                onClick={() => toggle(d)}
                className={`grid size-8 place-items-center rounded-full border text-[12px] font-medium transition-colors ${
                  on ? "border-brand-border bg-brand text-brand-on" : "border-line text-muted hover:bg-hover hover:text-fg"
                }`}
              >
                {dayName(d, "short").slice(0, 2)}
              </button>
            );
          })}
        </div>
      )}
      {freq === "MONTHLY" && !fromCompletion && (
        <label className="flex items-center gap-2">
          <span className="text-muted">On the</span>
          <select aria-label="Day of the month" value={monthDay} onChange={(e) => setMonthDay(Number(e.target.value))} className={field}>
            {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
              <option key={d} value={d}>
                {d === 31 ? "last day" : ordinal(d)}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="flex items-start gap-2">
        <input type="checkbox" checked={fromCompletion} onChange={(e) => setFromCompletion(e.target.checked)} className="mt-0.5 accent-[var(--brand)]" />
        <span>
          Count from completion
          <span className="block text-[11.5px] text-faint">The next date counts from the day you complete it, not from the due date.</span>
        </span>
      </label>
      <div className="rounded-md bg-hover px-2.5 py-2 text-[12.5px]" aria-live="polite">
        <p className="font-medium">{capital(label)}</p>
        <p className="text-muted">
          {fromCompletion ? `Starts ${shortDate(first)}` : `Next: ${[...new Set(upcoming)].map(shortDate).join(" · ")}`}
        </p>
      </div>
      <div className="flex justify-end gap-1.5">
        <button type="button" onClick={onBack} className={btn.ghost}>
          Back
        </button>
        <button type="button" onClick={save} className={btn.primary}>
          Save
        </button>
      </div>
    </div>
  );
}

const OFFSETS = [
  { min: 0, label: "At due time" },
  { min: 15, label: "15 min before" },
  { min: 30, label: "30 min before" },
  { min: 60, label: "1 hour before" },
  { min: 24 * 60, label: "1 day before" },
];

function describe(r: Task["reminders"][number], task: Task, tz: string): string {
  // Shown in the viewer's zone, the one it was entered in, not the browser's.
  if (r.kind === "absolute") return new Date(r.at).toLocaleString("en-GB", { timeZone: tz, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const o = OFFSETS.find((x) => x.min === r.offsetMin);
  const base = task.dueTime ? "" : " (from 09:00)";
  return (o?.label ?? `${r.offsetMin} min before`) + base;
}

/**
 * A timed task always reminds at its due time; extra reminders are relative
 * to the due time (09:00 for all-day tasks) or an absolute date and time.
 */
export function RemindersEditor({ task, tz, onChange }: { task: Task; tz: string; onChange: (r: ReminderInput[]) => void }) {
  const [adding, setAdding] = useState(false);
  const [at, setAt] = useState("");
  const current: ReminderInput[] = task.reminders.map((r) => (r.kind === "absolute" ? { kind: "absolute", at: r.at } : { kind: "relative", offsetMin: r.offsetMin }));
  const add = (r: ReminderInput) => {
    onChange([...current, r]);
    setAdding(false);
    setAt("");
  };
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-1.5">
      {task.dueTime && (
        <span className="inline-flex h-6 items-center gap-1 rounded-full border border-line px-2 text-[12px] text-muted" title="Timed tasks always remind at their due time">
          <Icon name="clock" size={12} /> At {task.dueTime}
        </span>
      )}
      {task.reminders.map((r, i) => (
        <span key={r.id} className="inline-flex h-6 items-center gap-1 rounded-full border border-line pl-2 pr-0.5 text-[12px] text-muted">
          <Icon name="bell" size={12} /> {describe(r, task, tz)}
          <button type="button" onClick={() => onChange(current.filter((_, j) => j !== i))} aria-label="Remove reminder" className="grid size-5 place-items-center rounded-full text-faint hover:bg-hover hover:text-fg">
            <Icon name="x" size={11} />
          </button>
        </span>
      ))}
      {adding ? (
        <span className="inline-flex flex-wrap items-center gap-1">
          {task.dueDate && (
            <select
              aria-label="Remind before"
              defaultValue=""
              onChange={(e) => e.target.value !== "" && add({ kind: "relative", offsetMin: Number(e.target.value) })}
              className="h-7 rounded-md border border-line bg-surface px-1.5 text-[12.5px] outline-none"
            >
              <option value="" disabled>
                Before due…
              </option>
              {OFFSETS.map((o) => (
                <option key={o.min} value={o.min}>
                  {o.min === 0 && !task.dueTime ? "On the day at 09:00" : o.label}
                </option>
              ))}
            </select>
          )}
          <input type="datetime-local" aria-label="Remind at" value={at} onChange={(e) => setAt(e.target.value)} className="h-7 rounded-md border border-line bg-surface px-2 text-[12.5px] outline-none" />
          <button
            type="button"
            disabled={!at}
            onClick={() => {
              const [d = "", t = "09:00"] = at.split("T");
              add({ kind: "absolute", at: zonedToUtc(d, t, tz).toISOString() });
            }}
            className={btn.outline}
          >
            Add
          </button>
          <button type="button" onClick={() => setAdding(false)} className={btn.ghost}>
            Cancel
          </button>
        </span>
      ) : (
        <button type="button" onClick={() => setAdding(true)} className={btn.ghost}>
          <Icon name="plus" size={13} /> Reminder
        </button>
      )}
      {!task.dueTime && task.reminders.length === 0 && !adding && <span className="text-[11.5px] text-faint">All-day tasks don&apos;t remind unless you add one</span>}
    </span>
  );
}
