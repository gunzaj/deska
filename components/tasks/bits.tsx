"use client";

import { useRef, useState, type ReactNode } from "react";
import { dueLabel, type DueTone } from "@/lib/tasks/dates";
import { PRIORITIES, type Access, type Priority } from "@/lib/tasks/model";
import { useAppData } from "../app/provider";
import { Icon } from "../icons";
import { Avatar } from "../props";
import { btn, PickList, Popover, type PickItem } from "../ui/popover";
import { useTasks } from "./store";

// Small visual atoms and pickers for tasks.

/** Todoist colours: P1 red, P2 orange, P3 blue, P4 neutral. */
const PRIORITY_COLOR: Record<Priority, string> = {
  1: "var(--prio-1)",
  2: "var(--prio-2)",
  3: "var(--prio-3)",
  4: "var(--fg-faint)",
};

export function priorityLabel(p: Priority): string {
  const o = PRIORITIES.find((x) => x.value === p)!;
  return `${o.short} ${o.label}`;
}

/** Round checkbox, ringed in the priority colour, as in Todoist. */
export function TaskCheck({
  done,
  priority,
  title,
  onToggle,
  disabled,
}: {
  done: boolean;
  priority: Priority;
  title: string;
  onToggle: () => void;
  /** Visible but not editable by the viewer (a sub-task seen through its parent). */
  disabled?: boolean;
}) {
  const c = PRIORITY_COLOR[priority];
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={done}
      disabled={disabled}
      aria-label={done ? `Mark "${title}" as not done` : `Complete "${title}"`}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className="group/check grid size-[18px] shrink-0 place-items-center rounded-full border-[1.6px] transition-colors disabled:cursor-not-allowed disabled:opacity-50"
      style={{ borderColor: c, background: done ? c : `color-mix(in srgb, ${c} ${priority === 4 ? 0 : 10}%, transparent)` }}
    >
      <Icon
        name="check"
        size={11}
        strokeWidth={3}
        className={done ? "text-surface" : "opacity-0 transition-opacity group-hover/check:opacity-100"}
        style={done ? undefined : { color: c }}
      />
    </button>
  );
}

const TONE: Record<DueTone, string> = {
  overdue: "text-critical",
  today: "text-brand-text",
  soon: "text-[var(--prio-2)]",
  later: "text-muted",
};

/** Due date (and time) with Todoist colouring; a timed task turns red once its time passes. */
export function DueChip({ date, time, today, now, done, repeat }: { date: string; time?: string | null; today: string; now?: string; done?: boolean; repeat?: boolean }) {
  const { text, tone } = dueLabel(date, today);
  const late = tone === "today" && time != null && now != null && time < now;
  return (
    <span className={`inline-flex items-center gap-1 text-[12px] ${done ? "text-faint" : TONE[late ? "overdue" : tone]}`} title={time ? `${date} ${time}` : date}>
      <Icon name="calendar" size={12} />
      {text}
      {time && <span className="tabular-nums">{time}</span>}
      {repeat && <Icon name="repeat" size={11} aria-label="Repeats" />}
    </span>
  );
}

export function PriorityFlag({ priority, size = 13 }: { priority: Priority; size?: number }) {
  return (
    <span role="img" aria-label={priorityLabel(priority)} className="inline-grid">
      <Icon name="flag" size={size} style={{ color: PRIORITY_COLOR[priority] }} />
    </span>
  );
}

export function accessHint(a: Access | undefined): string | null {
  if (a === "pending") return "not on Deska yet";
  return null;
}

/** Priority dropdown: P1–P4. */
export function PriorityPicker({ value, onChange }: { value: Priority; onChange: (p: Priority) => void }) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const items: PickItem[] = PRIORITIES.map((p) => ({
    id: String(p.value),
    label: `${p.short} · ${p.label}`,
    icon: <PriorityFlag priority={p.value} />,
    checked: p.value === value,
  }));
  return (
    <>
      <button ref={anchor} type="button" onClick={() => setOpen(true)} className={btn.ghost} aria-label={`Priority: ${priorityLabel(value)}`}>
        <PriorityFlag priority={value} />
        {priorityLabel(value)}
      </button>
      <Popover anchor={anchor} open={open} onClose={() => setOpen(false)} width={200}>
        <PickList
          items={items}
          placeholder="Priority…"
          onPick={(id) => {
            onChange(Number(id) as Priority);
            setOpen(false);
          }}
        />
      </Popover>
    </>
  );
}

const UNASSIGNED = "__none";

/**
 * Assignee dropdown over the repo's assignable users (§12.1). People who can't
 * see the task yet are marked, so you know they won't notice it.
 */
export function AssigneePicker({
  value,
  onChange,
  access,
  noneLabel = "No assignee",
  hideMe = false,
}: {
  value: string | null;
  onChange: (login: string | null) => void;
  access: Record<string, Access>;
  noneLabel?: string;
  /** For the creator, "me" is the same as unassigned, so it isn't listed twice. */
  hideMe?: boolean;
}) {
  const { data, viewer, avatarOf } = useAppData();
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const me = viewer.toLowerCase();
  const logins = [...new Set([me, ...data.meta.users.map((u) => u.login.toLowerCase())])].filter((l) => !(hideMe && l === me));
  const items: PickItem[] = [
    { id: UNASSIGNED, label: noneLabel, icon: <Icon name="user" size={14} className="text-faint" />, checked: value == null },
    ...logins
      .sort((a, b) => (a === me ? -1 : b === me ? 1 : a.localeCompare(b)))
      .map((l) => ({
        id: l,
        label: l === me ? `${l} (me)` : l,
        icon: <Avatar login={l} url={avatarOf(l)} size={16} />,
        hint: accessHint(access[l]) ?? undefined,
        checked: value === l,
      })),
  ];
  return (
    <>
      <button ref={anchor} type="button" onClick={() => setOpen(true)} className={btn.ghost} aria-label={`Assignee: ${value ?? "none"}`}>
        {value ? <Avatar login={value} url={avatarOf(value)} size={16} /> : <Icon name="user" size={14} className="text-faint" />}
        {value ?? noneLabel}
      </button>
      <Popover anchor={anchor} open={open} onClose={() => setOpen(false)} width={280}>
        <PickList
          items={items}
          placeholder="Assign to…"
          onPick={(id) => {
            onChange(id === UNASSIGNED ? null : id);
            setOpen(false);
          }}
        />
      </Popover>
    </>
  );
}

/** Native date (and optional time) inputs styled like the rest, with a clear button. `repeat` sits after the time. */
export function DueInput({
  value,
  onChange,
  time,
  onTimeChange,
  repeat,
  label = "Due date",
}: {
  value: string | null;
  onChange: (d: string | null) => void;
  time?: string | null;
  onTimeChange?: (t: string | null) => void;
  repeat?: ReactNode;
  label?: string;
}) {
  const field = "h-7 rounded-md border border-line bg-surface px-2 text-[12.5px] text-fg outline-none focus:border-[var(--focus)]";
  return (
    <span className="inline-flex items-center gap-1">
      <input type="date" aria-label={label} value={value ?? ""} onChange={(e) => onChange(e.target.value || null)} className={field} />
      {onTimeChange && value && (
        <input type="time" aria-label="Due time" value={time ?? ""} onChange={(e) => onTimeChange(e.target.value || null)} className={`${field} w-[6.5rem]`} />
      )}
      {repeat}
      {value && (
        <button
          type="button"
          onClick={() => {
            onChange(null);
            onTimeChange?.(null);
          }}
          className={btn.icon}
          aria-label="Clear due date"
          title="Clear due date"
        >
          <Icon name="x" size={13} />
        </button>
      )}
    </span>
  );
}

/** The task store's last failure (a save, delete or load), dismissible. */
export function TaskErrorBanner() {
  const { error, clearError } = useTasks();
  if (!error) return null;
  return (
    <div role="alert" className="flex items-center gap-2 border-b border-line bg-critical-soft px-4 py-2 text-[12.5px] text-critical">
      <span className="flex-1">{error}</span>
      <button type="button" onClick={clearError} className={btn.icon} aria-label="Dismiss error">
        <Icon name="x" size={13} />
      </button>
    </div>
  );
}
