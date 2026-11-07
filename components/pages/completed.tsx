"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { groupByDay } from "@/lib/client/completed";
import { usePoll } from "@/lib/client/poll";
import { isUnauthorized } from "@/lib/client/session";
import { COMPLETED_DAYS, type CompletedItem } from "@/lib/tasks/model";
import { Page } from "../app/shell";
import { Icon } from "../icons";
import { EmptyHint } from "../props";
import { TaskCheck, TaskErrorBanner } from "../tasks/bits";
import { openTask } from "../tasks/open-task";
import { ColorDot } from "../tasks/organize";
import { useToday } from "../tasks/notifications";
import { useTasks } from "../tasks/store";
import { GroupSection } from "../tasks/task-row";
import { useToast } from "../ui/toast";
import { btn } from "../ui/popover";

/** Completed: the last 30 days by day, with un-complete (SPEC §4.6, D13). */
export function TaskCompletedPage() {
  const { projects, sections, update } = useTasks();
  const { toast } = useToast();
  const { today, tz } = useToday();
  const [items, setItems] = useState<CompletedItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lastLoad = useRef(0);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/tasks/completed", { cache: "no-store" });
      if (isUnauthorized(res)) return;
      if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? `HTTP ${res.status}`);
      setItems(((await res.json()) as { items: CompletedItem[] }).items);
      setError(null);
      lastLoad.current = Date.now();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);
  usePoll(load, { every: 30_000, minGap: 30_000, lastRun: lastLoad });

  const days = useMemo(() => (items ? groupByDay(items, tz, today) : []), [items, tz, today]);

  /** Un-complete: a task reopens where it was filed (project, section, order); a recurring task's occurrence is taken back. */
  const reopen = async (it: CompletedItem) => {
    const res = await update(it.task.id, it.occurrence ? { undoOccurrence: it.occurrence } : { completed: false });
    if (res) toast({ message: `Reopened “${it.task.title}”` });
    void load();
  };

  return (
    <Page title="Completed" icon={<Icon name="circleCheck" size={15} />}>
      <TaskErrorBanner />
      {error && (
        <div role="alert" data-list-state="error" className="flex items-center gap-2 border-b border-line bg-banner-warning px-4 py-2 text-[12.5px] text-warning">
          <span className="flex-1">Could not load completed tasks: {error}</span>
          <button type="button" onClick={() => void load()} className={btn.outline}>
            Retry
          </button>
        </div>
      )}
      {items == null ? (
        error ? null : <p data-list-state="loading" className="p-6 text-muted">Loading…</p>
      ) : days.length === 0 ? (
        <div data-list-state="empty">
          <EmptyHint icon="circleCheck" title="Nothing completed yet" hint={`Tasks you complete in the last ${COMPLETED_DAYS} days show up here.`} />
        </div>
      ) : (
        days.map((d) => (
          <GroupSection key={d.day} title={d.title} count={d.items.length}>
            {d.items.map((it) => {
              const project = it.task.projectId ? projects.find((p) => p.id === it.task.projectId) : null;
              const section = it.task.sectionId ? sections.find((s) => s.id === it.task.sectionId) : null;
              return (
                <li key={it.key} data-completed-row={it.task.id} className="flex min-h-11 items-center gap-3 border-b border-line-soft px-4 py-2.5 hover:bg-hover">
                  {it.occurrence ? (
                    <button
                      type="button"
                      disabled={!it.undoable}
                      onClick={() => void reopen(it)}
                      aria-label={`Take back the ${it.occurrence} occurrence of "${it.task.title}"`}
                      title={it.undoable ? "Take this occurrence back" : "A later occurrence replaced it"}
                      className="grid size-[18px] shrink-0 place-items-center rounded-full border-[1.6px] border-line bg-hover text-faint disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Icon name="repeat" size={10} />
                    </button>
                  ) : (
                    <TaskCheck done priority={it.task.priority} title={it.task.title} onToggle={() => void reopen(it)} />
                  )}
                  <button type="button" onClick={() => openTask(it.task.id)} className="min-w-0 flex-1 truncate text-left text-[13.5px] text-muted line-through decoration-faint">
                    {it.task.title}
                  </button>
                  {it.occurrence && <span className="shrink-0 text-[12px] text-faint">repeat · due {it.occurrence}</span>}
                  {project && (
                    <span className="inline-flex shrink-0 items-center gap-1 text-[12px] text-faint">
                      <ColorDot color={project.color} size={7} />
                      {project.name}
                      {section ? ` / ${section.name}` : ""}
                    </span>
                  )}
                  <time dateTime={it.at} className="shrink-0 text-[12px] tabular-nums text-faint">
                    {new Date(it.at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: tz })}
                  </time>
                </li>
              );
            })}
          </GroupSection>
        ))
      )}
    </Page>
  );
}
