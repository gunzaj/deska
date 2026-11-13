"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { formatDate, longAgo } from "@/lib/client/format";
import { labelNameOf } from "@/lib/client/task-optimistic";
import type { Task } from "@/lib/tasks/model";
import { Icon } from "../icons";
import { EmptyHint } from "../props";
import { Dialog } from "../ui/dialog";
import { btn } from "../ui/popover";
import { DueChip, DueInput, PriorityPicker, TaskCheck, TaskErrorBanner } from "./bits";
import { TaskComments } from "./comments";
import { AddLinkButton, LinkChip } from "./links";
import { RemindersEditor, RepeatPicker } from "./schedule";
import { useToday } from "./notifications";
import { LabelPicker, ProjectPicker } from "./organize";
import { SectionPicker } from "./sections";
import { closeTask, openTask, TASK_PARAM } from "./open-task";
import { useTasks } from "./store";
import { usePanelFocus } from "../app/panel-focus";
import { useTasksOnly } from "../app/tasks-only";

/** Side panel for `?task=<id>`, over the right of the content like the issue panel. */
export function TaskPeek() {
  const params = useSearchParams();
  const id = params.get(TASK_PARAM);
  const panel = useRef<HTMLElement>(null);
  const shown = useRef(id);
  shown.current = id;
  usePanelFocus(panel, !!id, () => (shown.current ? `[data-task-row="${shown.current}"]` : null));

  useEffect(() => {
    if (!id) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
      if (document.querySelector('[role="dialog"]')) return;
      closeTask();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [id]);

  if (!id) return null;
  return (
    <aside
      ref={panel}
      role="complementary"
      data-side-panel
      aria-label="Task"
      className="anim-slide fixed inset-0 z-30 flex flex-col bg-surface md:inset-y-3 md:left-auto md:right-3 md:w-[min(40rem,calc(100vw-260px))] md:rounded-xl md:border md:border-line md:shadow-modal"
    >
      <TaskPanel key={id} id={id} />
    </aside>
  );
}

function Prop({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-8 items-center gap-2">
      <dt className="w-[5.5rem] shrink-0 text-[12.5px] text-faint">{label}</dt>
      <dd className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 text-[13px]">{children}</dd>
    </div>
  );
}

function TaskPanel({ id }: { id: string }) {
  const { tasks, update, remove } = useTasks();
  // The store holds the newest 200 completed tasks; an older one (opened from
  // Completed) is read from the server instead (T-5).
  const [fetched, setFetched] = useState<Task | null>(null);
  const task = tasks.find((t) => t.id === id) ?? (fetched?.id === id ? fetched : null);
  // Rendered description, tagged with the text it was rendered from: a stale
  // render (a colleague edited it, or an edit is still saving) isn't shown.
  const [rendered, setRendered] = useState<{ from: string; html: string } | null>(null);
  const [missing, setMissing] = useState(false);
  const [failed, setFailed] = useState(false);
  const description = task?.description;
  const latest = useRef({ description, rendered });
  latest.current = { description, rendered };

  // The list has the fields; the rendered description comes from the server.
  useEffect(() => {
    if (description !== undefined && latest.current.rendered?.from === description) return;
    const ctrl = new AbortController();
    fetch(`/api/tasks/${id}`, { cache: "no-store", signal: ctrl.signal })
      .then(async (res) => {
        if (res.status === 404) return setMissing(true);
        if (!res.ok) return setFailed(true);
        const body = (await res.json()) as { task: Task; descriptionHtml: string };
        setFetched(body.task);
        // A save may have rendered the current text while this was on its way.
        setRendered((prev) => (prev && prev.from === latest.current.description ? prev : { from: body.task.description, html: body.descriptionHtml }));
      })
      .catch(() => {});
    return () => ctrl.abort();
  }, [id, description]);

  if (!task) {
    return (
      <>
        <PanelTop />
        {missing ? (
          <EmptyHint icon="alert" title="Task not found" hint="It was deleted." />
        ) : failed ? (
          <EmptyHint icon="alert" title="Could not load the task" hint="Check the connection and open it again." />
        ) : (
          <p className="p-6 text-muted">Loading…</p>
        )}
      </>
    );
  }
  const html = rendered?.from === task.description ? rendered.html : null;
  // A task the store doesn't hold has no optimistic copy: show the server's answer.
  const save: typeof update = async (tid, patch) => {
    const res = await update(tid, patch);
    if (res && !tasks.some((t) => t.id === tid)) setFetched(res.task);
    return res;
  };
  return <TaskBody task={task} html={html} setRendered={setRendered} update={save} remove={remove} />;
}

function PanelHeader({ children }: { children?: ReactNode }) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-1.5 border-b border-line px-3">
      <Icon name="check" size={14} className="text-faint" />
      <span className="flex-1 text-[12.5px] font-medium text-muted">Task</span>
      {children}
      <button type="button" onClick={closeTask} className={btn.icon} aria-label="Close task" title="Close (Esc)">
        <Icon name="x" size={15} />
      </button>
    </header>
  );
}

/** Header plus the store's error banner, so a failed save shows on any page. */
function PanelTop({ children }: { children?: ReactNode }) {
  return (
    <>
      <PanelHeader>{children}</PanelHeader>
      <TaskErrorBanner />
    </>
  );
}

function TaskBody({
  task,
  html,
  setRendered,
  update,
  remove,
}: {
  task: Task;
  html: string | null;
  setRendered: (r: { from: string; html: string }) => void;
  update: ReturnType<typeof useTasks>["update"];
  remove: ReturnType<typeof useTasks>["remove"];
}) {
  const [title, setTitle] = useState(task.title);
  const [editingDesc, setEditingDesc] = useState(false);
  const [desc, setDesc] = useState(task.description);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { tasks, labels, sections, toggleComplete } = useTasks();
  const { today, now, tz } = useToday();
  const tasksOnly = useTasksOnly();
  const parent = task.parentId ? tasks.find((t) => t.id === task.parentId) : null;
  const myLabels = task.labels.map((id) => labelNameOf(id, labels)).filter((n): n is string => Boolean(n));
  const done = Boolean(task.completedAt);

  useEffect(() => setTitle(task.title), [task.title]);
  useEffect(() => {
    if (!editingDesc) setDesc(task.description);
  }, [task.description, editingDesc]);

  const saveTitle = () => {
    const t = title.trim();
    if (!t) return setTitle(task.title);
    if (t !== task.title) void update(task.id, { title: t });
  };
  const saveDesc = async () => {
    if (desc === task.description) return setEditingDesc(false);
    const r = await update(task.id, { description: desc });
    // Keep the editor (and the typed text) open if the save failed.
    if (r) {
      setEditingDesc(false);
      setRendered({ from: r.task.description, html: r.descriptionHtml });
    }
  };

  return (
    <>
      <PanelTop>
        {task.recurrence && !done && (
          <button type="button" onClick={() => void update(task.id, { completed: true, endRecurrence: true })} className={btn.ghost} title="Stop repeating and complete">
            <Icon name="check" size={13} /> Complete forever
          </button>
        )}
        <button type="button" onClick={() => setConfirmDelete(true)} className={btn.icon} aria-label="Delete task" title="Delete task">
          <Icon name="trash" size={14} />
        </button>
      </PanelTop>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {parent && (
          <button type="button" onClick={() => openTask(parent.id)} className="mb-2 flex max-w-full items-center gap-1 pl-[30px] text-[12.5px] text-muted hover:text-fg" title="Open parent task">
            <span className="truncate">{parent.title}</span>
            <Icon name="chevronRight" size={12} className="shrink-0 text-faint" />
          </button>
        )}
        <div className="contents">
          <div className="flex items-start gap-3">
            <span className="pt-1.5">
              <TaskCheck done={done} priority={task.priority} title={task.title} onToggle={() => toggleComplete(task)} />
            </span>
            <textarea
              aria-label="Title"
              value={title}
              rows={1}
              onChange={(e) => setTitle(e.target.value.replace(/\n/g, " "))}
              onBlur={saveTitle}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  (e.target as HTMLTextAreaElement).blur();
                } else if (e.key === "Escape") {
                  setTitle(task.title);
                }
              }}
              className={`field-sizing-content min-w-0 flex-1 resize-none bg-transparent text-[18px] font-semibold leading-snug outline-none ${done ? "text-muted line-through" : ""}`}
            />
          </div>

          <div className="mt-3 pl-[30px]">
            {editingDesc ? (
              <div>
                <textarea
                  aria-label="Description"
                  autoFocus
                  value={desc}
                  onChange={(e) => setDesc(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void saveDesc();
                    if (e.key === "Escape") {
                      e.stopPropagation();
                      setDesc(task.description);
                      setEditingDesc(false);
                    }
                  }}
                  placeholder="Add context, links, acceptance notes… (markdown)"
                  className="min-h-32 w-full resize-y rounded-lg border border-line bg-surface p-2.5 font-mono text-[12.5px] outline-none focus:border-[var(--focus)]"
                />
                <div className="mt-1.5 flex items-center gap-1.5">
                  <button type="button" onClick={() => void saveDesc()} className={btn.primary}>
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDesc(task.description);
                      setEditingDesc(false);
                    }}
                    className={btn.ghost}
                  >
                    Cancel
                  </button>
                  <span className="ml-auto text-[11.5px] text-faint">Markdown · ⌘↵ to save</span>
                </div>
              </div>
            ) : task.description ? (
              <button type="button" onClick={() => setEditingDesc(true)} className="block w-full rounded-lg text-left hover:bg-hover" aria-label="Edit description">
                {html != null ? (
                  <div className="gh-markdown px-1 py-1" dangerouslySetInnerHTML={{ __html: html }} />
                ) : (
                  <p className="whitespace-pre-wrap px-1 py-1 text-[14px]">{task.description}</p>
                )}
              </button>
            ) : (
              <button type="button" onClick={() => setEditingDesc(true)} className="text-[13px] text-faint hover:text-muted">
                Add description…
              </button>
            )}
          </div>

          <section className="mt-4 pl-[30px]" aria-label="Linked issues">
            {task.links.length > 0 && (
              <div className="mb-1.5 space-y-1.5">
                {task.links.map((l) => (
                  <LinkChip key={l.nodeId} link={l} onRemove={() => void update(task.id, { links: task.links.filter((x) => x.nodeId !== l.nodeId).map((x) => x.number) })} />
                ))}
              </div>
            )}
            {!tasksOnly && <AddLinkButton linked={task.links.map((l) => l.number)} onAdd={(n) => void update(task.id, { links: [...task.links.map((l) => l.number), n] })} />}
          </section>

          {!task.parentId && <SubTasks parent={task} />}

          <dl className="mt-5 space-y-0.5 border-t border-line pt-3">
            <Prop label="Due date">
              <DueInput
                value={task.dueDate}
                onChange={(d) => void update(task.id, { dueDate: d, ...(task.dueTz ? {} : { tz }) })}
                time={task.dueTime}
                onTimeChange={(t) => void update(task.id, { dueTime: t, tz })}
                repeat={
                  <RepeatPicker
                    value={task.recurrence}
                    dueDate={task.dueDate}
                    today={today}
                    // The due date moves to the rule's first day (Tue/Fri rule on a Monday → Tuesday).
                    onChange={(r, firstDate) =>
                      void update(task.id, { recurrence: r, ...(firstDate && firstDate !== task.dueDate ? { dueDate: firstDate, ...(task.dueTz ? {} : { tz }) } : {}) })
                    }
                  />
                }
              />
              {task.dueDate && <DueChip date={task.dueDate} time={task.dueTime} repeat={Boolean(task.recurrence)} today={today} now={now} done={done} />}
            </Prop>
            <Prop label="Reminders">
              <RemindersEditor task={task} tz={tz} onChange={(reminders) => void update(task.id, { reminders })} />
            </Prop>
            <Prop label="Priority">
              <PriorityPicker value={task.priority} onChange={(p) => void update(task.id, { priority: p })} />
            </Prop>
            {/* A sub-task lives under its parent; a project page lists only top-level tasks (T-8). */}
            {!task.parentId && (
              <Prop label="Project">
                <ProjectPicker value={task.projectId} onChange={(id) => void update(task.id, { projectId: id })} />
              </Prop>
            )}
            {task.projectId && !task.parentId && sections.some((s) => s.projectId === task.projectId) && (
              <Prop label="Section">
                <SectionPicker projectId={task.projectId} value={task.sectionId} onChange={(id) => void update(task.id, { sectionId: id })} />
              </Prop>
            )}
            <Prop label="Labels">
              <LabelPicker value={myLabels} onChange={(names) => void update(task.id, { labels: names })} />
            </Prop>
            <Prop label="Created">
              <span className="text-faint" title={task.createdAt}>
                {longAgo(task.createdAt)}
              </span>
            </Prop>
            {done && (
              <Prop label="Completed">
                <span>{formatDate(task.completedAt!)}</span>
              </Prop>
            )}
          </dl>
        </div>

        <TaskComments taskId={task.id} />
      </div>

      <Dialog open={confirmDelete} onClose={() => setConfirmDelete(false)} label="Delete task" width={400}>
        <div className="p-4">
          <p className="text-[14px] font-semibold">Delete this task?</p>
          <p className="mt-1 text-muted">
            “{task.title}” will be removed.
          </p>
          <div className="mt-4 flex justify-end gap-1.5">
            <button type="button" onClick={() => setConfirmDelete(false)} className={btn.outline}>
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirmDelete(false);
                void remove(task.id).then((ok) => {
                  if (ok) closeTask();
                });
              }}
              className="inline-flex h-7 items-center rounded-md bg-[var(--prio-1)] px-2.5 text-[12.5px] font-semibold text-white hover:opacity-90"
            >
              Delete
            </button>
          </div>
        </div>
      </Dialog>
    </>
  );
}

/** One level of sub-tasks (§12.1): full tasks, listed and added inline. */
function SubTasks({ parent }: { parent: Task }) {
  const { tasks, create, toggleComplete } = useTasks();
  const [title, setTitle] = useState("");
  const { today, now } = useToday();
  const subs = tasks
    .filter((t) => t.parentId === parent.id)
    .sort((a, b) => Number(Boolean(a.completedAt)) - Number(Boolean(b.completedAt)) || a.createdAt.localeCompare(b.createdAt));
  const done = subs.filter((t) => t.completedAt).length;
  const add = async () => {
    const t = title.trim();
    if (!t) return;
    setTitle("");
    // Give the text back if it didn't save (unless something new was typed).
    if (!(await create({ title: t, parentId: parent.id }))) setTitle((cur) => cur || t);
  };
  return (
    <section className="mt-4 pl-[30px]" aria-label="Sub-tasks">
      <h3 className="mb-1.5 flex items-center gap-2 text-[12.5px] font-semibold text-muted">
        Sub-tasks
        {subs.length > 0 && (
          <span className="font-normal text-faint">
            {done}/{subs.length}
          </span>
        )}
      </h3>
      {subs.length > 0 && (
        <ul className="mb-1.5 divide-y divide-line-soft rounded-lg border border-line">
          {subs.map((t) => {
            const isDone = Boolean(t.completedAt);
            return (
              <li key={t.id} className="flex items-center gap-2.5 px-2.5 py-1.5">
                <TaskCheck done={isDone} priority={t.priority} title={t.title} onToggle={() => toggleComplete(t)} />
                <button type="button" onClick={() => openTask(t.id)} className={`min-w-0 flex-1 truncate text-left text-[13px] ${isDone ? "text-faint line-through" : ""}`}>
                  {t.title}
                </button>
                {t.dueDate && <DueChip date={t.dueDate} time={t.dueTime} repeat={Boolean(t.recurrence)} today={today} now={now} done={isDone} />}
              </li>
            );
          })}
        </ul>
      )}
      <input
        aria-label="Add sub-task"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.nativeEvent.isComposing) {
            e.preventDefault();
            void add();
          }
        }}
        placeholder="+ Add sub-task"
        maxLength={500}
        className="h-8 w-full rounded-md bg-transparent px-1 text-[13px] outline-none placeholder:text-faint focus:bg-field"
      />
    </section>
  );
}
