"use client";

import { canEdit, compareTasks } from "@/lib/tasks/model";
import { useAppData } from "../app/provider";
import { Icon } from "../icons";
import { Avatar } from "../props";
import { btn } from "../ui/popover";
import { DueChip, TaskCheck } from "./bits";
import { useToday } from "./notifications";
import { openTask } from "./open-task";
import { useTasks } from "./store";

/** "Add to tasks" for an issue: quick add with it attached and an empty title (§12.1). */
function AddToTasksButton({ number }: { number: number }) {
  const { openCompose } = useTasks();
  return (
    <button type="button" onClick={() => openCompose({ links: [number] })} className={btn.outline} title="Add to tasks (T)">
      <Icon name="plus" size={13} /> Add to tasks
    </button>
  );
}

/**
 * Tasks the viewer can see that link this item (§12.8). Only tasks already
 * loaded for the viewer are listed, so nobody else's tasks can appear here.
 */
export function LinkedTasks({ nodeId, number }: { nodeId: string; number: number }) {
  const { tasks, toggleComplete } = useTasks();
  const { viewer, avatarOf } = useAppData();
  const me = viewer.toLowerCase();
  const { today, now } = useToday();
  const linked = tasks.filter((t) => t.links.some((l) => l.nodeId === nodeId)).sort((a, b) => Number(Boolean(a.completedAt)) - Number(Boolean(b.completedAt)) || compareTasks(a, b));
  return (
    <section aria-label="Tasks">
      <h3 className="mb-2 flex items-center gap-2 text-[12.5px] font-semibold text-muted">
        Tasks
        {linked.length > 0 && <span className="font-normal text-faint">{linked.length}</span>}
        <span className="flex-1" />
        <AddToTasksButton number={number} />
      </h3>
      {linked.length === 0 ? (
        <p className="text-[12.5px] text-faint">No tasks for this yet. Add one to come back to it later.</p>
      ) : (
        <ul className="divide-y divide-line-soft rounded-xl border border-line">
          {linked.map((t) => {
            const done = Boolean(t.completedAt);
            const other = t.assignee && t.assignee !== me ? t.assignee : t.creator !== me ? t.creator : null;
            return (
              <li key={t.id} className="flex items-center gap-2.5 px-3 py-2">
                <TaskCheck done={done} priority={t.priority} title={t.title} onToggle={() => toggleComplete(t)} disabled={!canEdit(t, viewer)} />
                <button type="button" onClick={() => openTask(t.id)} className={`min-w-0 flex-1 truncate text-left text-[13px] ${done ? "text-faint line-through" : ""}`}>
                  {t.title}
                </button>
                {t.dueDate && <DueChip date={t.dueDate} time={t.dueTime} repeat={Boolean(t.recurrence)} today={today} now={now} done={done} />}
                {other && <Avatar login={other} url={avatarOf(other)} size={18} />}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
