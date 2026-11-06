"use client";

import { useSearchParams } from "next/navigation";
import { useRef, type ReactNode } from "react";
import { canEdit, type Task } from "@/lib/tasks/model";
import { useAppData } from "../app/provider";
import { Icon } from "../icons";
import { Avatar } from "../props";
import { accessHint, DueChip, PriorityFlag, TaskCheck } from "./bits";
import { LinkChip } from "./links";
import { openTask, TASK_PARAM } from "./open-task";
import { ColorDot, LabelChip } from "./organize";
import { useTasks } from "./store";
import { TASK_LIST_KEYS } from "@/lib/client/shortcuts";
import { TASK_DRAG_TYPE } from "@/lib/client/task-drop";

export type SubCount = { total: number; done: number };

/** Sub-task progress per parent, in one pass (a per-row filter was O(n²)). */
export function subCounts(tasks: Task[]): Map<string, SubCount> {
  const out = new Map<string, SubCount>();
  for (const t of tasks) {
    if (!t.parentId) continue;
    const c = out.get(t.parentId) ?? { total: 0, done: 0 };
    c.total++;
    if (t.completedAt) c.done++;
    out.set(t.parentId, c);
  }
  return out;
}

export type Drag = {
  onDragStart: () => void;
  onDragEnd: () => void;
  onDrop: () => void;
  over: boolean;
  setOver: (v: boolean) => void;
  /** Touch reorder (U4): the handle reports the row under the finger, then drops on it. */
  touchOver: (id: string | null) => void;
  touchDrop: (id: string | null) => void;
};

const rowUnder = (e: { clientX: number; clientY: number }) =>
  document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-task-row]")?.dataset.taskRow ?? null;

export function TaskRow({
  task,
  today,
  now,
  showAssignee,
  hideProject,
  parentTitle,
  subs,
  drag,
  tabbable,
  onFocusRow,
  onMove,
}: {
  task: Task;
  today: string;
  now: string;
  showAssignee?: boolean;
  hideProject?: boolean;
  parentTitle?: string | null;
  subs?: SubCount;
  drag?: Drag;
  /** Roving focus (U2): the one row in the list that Tab reaches. */
  tabbable?: boolean;
  onFocusRow?: () => void;
  /** Alt+↑ / Alt+↓ on the row (U2): move it one place, like a drag. */
  onMove?: (dir: -1 | 1) => void;
}) {
  const handleDown = useRef(false);
  const { toggleComplete, access, projects, labels } = useTasks();
  const { viewer, avatarOf } = useAppData();
  const params = useSearchParams();
  const active = params.get(TASK_PARAM) === task.id;
  const me = viewer.toLowerCase();
  const done = Boolean(task.completedAt);
  const from = task.creator !== me ? task.creator : null;
  const hint = showAssignee && task.assignee ? accessHint(access[task.assignee]) : null;
  const project = !hideProject && task.projectId ? projects.find((p) => p.id === task.projectId) : null;
  const myLabels = task.labels.map((id) => labels.find((l) => l.id === id)).filter((l): l is NonNullable<typeof l> => l != null);
  return (
    <li
      draggable={!done}
      onDragStart={(e) => {
        // Every open task can be dragged onto the sidebar; only manual lists also reorder.
        e.dataTransfer.setData(TASK_DRAG_TYPE, task.id);
        e.dataTransfer.effectAllowed = "move";
        if (!drag) return;
        // A drag that began on the touch handle is the handle's own (a mouse would start both).
        if (handleDown.current) {
          e.preventDefault();
          return;
        }
        e.dataTransfer.effectAllowed = "move";
        drag.onDragStart();
      }}
      // A drag dropped outside the list must not leave a stale drag behind for the next drop.
      onDragEnd={() => drag?.onDragEnd()}
      onDragOver={(e) => {
        if (!drag) return;
        e.preventDefault();
        drag.setOver(true);
      }}
      onDragLeave={() => drag?.setOver(false)}
      onDrop={(e) => {
        if (!drag) return;
        e.preventDefault();
        drag.setOver(false);
        drag.onDrop();
      }}
      className={`group flex min-h-11 cursor-pointer items-start gap-3 border-b border-line-soft px-4 py-2.5 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus ${active ? "bg-active" : "hover:bg-hover"} ${drag?.over ? "shadow-[inset_0_2px_0_var(--brand-border)]" : ""}`}
      data-peek-row
      data-task-row={task.id}
      tabIndex={tabbable ? 0 : -1}
      aria-current={active ? "true" : undefined}
      onFocus={(e) => {
        if (e.target === e.currentTarget) onFocusRow?.();
      }}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
          if (!onMove) return;
          e.preventDefault();
          onMove(e.key === "ArrowUp" ? -1 : 1);
          return;
        }
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        const action = TASK_LIST_KEYS[e.key];
        if (action === "open") {
          e.preventDefault();
          openTask(task.id);
        } else if (action === "complete") {
          // Same as the checkbox: a repeating task moves to its next date.
          e.preventDefault();
          if (canEdit(task, viewer)) toggleComplete(task);
        } else if (action === "next" || action === "prev") {
          e.preventDefault();
          const rows = [...document.querySelectorAll<HTMLElement>("[data-task-row]")];
          rows[rows.indexOf(e.currentTarget) + (action === "next" ? 1 : -1)]?.focus();
        }
      }}
      onClick={() => openTask(task.id)}
    >
      <span className="pt-px">
        <TaskCheck done={done} priority={task.priority} title={task.title} onToggle={() => toggleComplete(task)} disabled={!canEdit(task, viewer)} />
      </span>
      <div className="min-w-0 flex-1">
        {parentTitle && <p className="truncate text-[11.5px] text-faint">{parentTitle} ›</p>}
        <button
          type="button"
          data-peek-title
          className={`block w-fit max-w-full truncate text-left text-[13.5px] ${done ? "text-faint line-through" : ""}`}
          onClick={(e) => {
            e.stopPropagation();
            openTask(task.id);
          }}
        >
          {task.title}
        </button>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 empty:hidden">
          {task.dueDate && <DueChip date={task.dueDate} time={task.dueTime} repeat={Boolean(task.recurrence)} today={today} now={now} done={done} />}
          {subs && subs.total > 0 && (
            <span className="inline-flex items-center gap-1 text-[12px] text-faint" title="Sub-tasks done">
              <Icon name="list" size={12} />
              {subs.done}/{subs.total}
            </span>
          )}
          {task.links.map((l) => (
            <LinkChip key={l.nodeId} link={l} compact />
          ))}
          {myLabels.map((l) => (
            <LabelChip key={l.id} label={l} />
          ))}
          {task.description && <Icon name="message" size={12} className="text-faint" aria-label="Has description" />}
          {from && <span className="text-[12px] text-faint">from {from}</span>}
          {hint && (
            <span className="text-[12px] text-warning">
              {task.assignee}: {hint}
            </span>
          )}
        </div>
      </div>
      <span className="flex shrink-0 items-center gap-2 pt-0.5">
        {drag && (
          // HTML5 drag does nothing on touch screens: a handle that follows the finger instead.
          <button
            type="button"
            data-drag-handle
            aria-label={`Reorder “${task.title}”`}
            title="Drag to reorder (or Alt+↑ / Alt+↓)"
            className="-my-2 -mr-2 hidden size-10 touch-none place-items-center text-faint [@media(pointer:coarse)]:grid"
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => {
              handleDown.current = true;
              e.currentTarget.setPointerCapture(e.pointerId);
              drag.onDragStart();
            }}
            onPointerMove={(e) => {
              if (e.currentTarget.hasPointerCapture(e.pointerId)) drag.touchOver(rowUnder(e));
            }}
            onPointerUp={(e) => {
              handleDown.current = false;
              drag.touchDrop(rowUnder(e));
            }}
            onPointerCancel={() => {
              handleDown.current = false;
              drag.onDragEnd();
            }}
          >
            <Icon name="grip" size={16} />
          </button>
        )}
        {project && (
          <span className="inline-flex items-center gap-1 text-[12px] text-faint">
            <ColorDot color={project.color} size={7} />
            {project.name}
          </span>
        )}
        {task.priority < 4 && <PriorityFlag priority={task.priority} />}
        {showAssignee && task.assignee && <Avatar login={task.assignee} url={avatarOf(task.assignee)} size={20} />}
      </span>
    </li>
  );
}

export function GroupSection({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <section aria-label={title}>
      <h2 className="sticky top-0 z-10 flex h-8 items-center gap-2 border-b border-line bg-surface px-4 text-[12px] font-semibold text-muted">
        {title}
        <span className="font-normal tabular-nums text-faint">{count}</span>
      </h2>
      <ul>{children}</ul>
    </section>
  );
}
