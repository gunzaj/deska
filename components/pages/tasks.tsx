"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { addDays, dueLabel } from "@/lib/tasks/dates";
import { compareCompleted, compareTasks, type PatchTaskInput, type Task, type TaskSection } from "@/lib/tasks/model";
import { Page } from "../app/shell";
import { Icon, type IconName } from "../icons";
import { EmptyHint } from "../props";
import { Dialog } from "../ui/dialog";
import { btn } from "../ui/popover";
import { TaskErrorBanner } from "../tasks/bits";
import { ColorDot, LabelDialog, ProjectDialog } from "../tasks/organize";
import { DeleteSectionDialog, movedPosition, SectionDialog, SectionMenu } from "../tasks/sections";
import { NEW_SOURCE } from "@/lib/client/project-source";
import { ProjectSourceSection } from "../tasks/project-source";
import { useAppViews } from "../app/provider";
import { taskViewMatches, taskViewPrefill, taskViewShowsSubtasks } from "@/lib/tasks/views";
import { useToday } from "../tasks/notifications";
import { PlanMyDay } from "../tasks/plan-my-day";
import { useTasks, type ComposePrefill } from "../tasks/store";
import { TidyInbox } from "../tasks/tidy-inbox";
import { useToast } from "../ui/toast";
import { GroupSection, subCounts, TaskRow } from "../tasks/task-row";

/**
 * `keepEmpty` keeps a header when the group has no tasks: Upcoming's days, and a project that also lists GitHub items.
 * `sectionId` marks a group of a project with sections (null = the tasks in none): dropping a task there files it
 * in that section. `section` makes the header a collapsible section header with `actions`.
 */
type Group = { key: string; title: string; tasks: Task[]; keepEmpty?: boolean; sectionId?: string | null; section?: TaskSection; actions?: ReactNode };

type Ctx = { today: string; byId: Map<string, Task> };

/** A view: which tasks, how they group, and what "New task" pre-fills (§12.8). */
type ViewDef = {
  title: string;
  icon: ReactNode;
  /** Include sub-tasks whose parent is also visible (dated views do). */
  withSubtasks?: boolean;
  /** Show tasks filed in archived projects (only that project's own page does). */
  withArchived?: boolean;
  filter: (t: Task, c: Ctx) => boolean;
  group: (open: Task[], c: Ctx) => Group[];
  prefill?: (c: Ctx) => ComposePrefill;
  /** Manual drag-and-drop order within the single group. */
  manual?: boolean;
  hideProject?: boolean;
  empty: { title: string; hint: string; icon: IconName };
  banner?: ReactNode;
  actions?: ReactNode;
  /** Rendered below the task groups (a project's GitHub items). */
  footer?: ReactNode;
};

function overdueSplit(open: Task[], today: string, restTitle: string): Group[] {
  const overdue = open.filter((t) => t.dueDate != null && t.dueDate < today);
  const rest = open.filter((t) => !(t.dueDate != null && t.dueDate < today));
  return [
    ...(overdue.length ? [{ key: "overdue", title: "Overdue", tasks: overdue }] : []),
    { key: "rest", title: overdue.length ? restTitle : "Open", tasks: rest },
  ];
}

function TaskList({ def }: { def: ViewDef }) {
  const { tasks, projects, loaded, openCompose, update, updateSection } = useTasks();
  const { toast } = useToast();
  const [showDone, setShowDone] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  // Roving focus (U2): the row Tab reaches.
  const [focusTaskId, setFocusTaskId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const { today, now } = useToday();

  const c: Ctx = useMemo(() => ({ today, byId: new Map(tasks.map((t) => [t.id, t])) }), [today, tasks]);
  const archived = useMemo(() => new Set(projects.filter((p) => p.archived).map((p) => p.id)), [projects]);
  const subs = useMemo(() => subCounts(tasks), [tasks]);

  const { groups, done } = useMemo(() => {
    const scoped = tasks.filter(
      (t) =>
        (def.withSubtasks || !(t.parentId && c.byId.has(t.parentId))) &&
        (def.withArchived || !(t.projectId && archived.has(t.projectId))) &&
        def.filter(t, c),
    );
    const open = scoped.filter((t) => !t.completedAt).sort(def.manual ? (a, b) => a.position - b.position : compareTasks);
    return { groups: def.group(open, c).filter((g) => g.tasks.length || g.keepEmpty), done: scoped.filter((t) => t.completedAt).sort(compareCompleted) };
  }, [tasks, def, c, archived]);

  const openCount = groups.reduce((n, g) => n + g.tasks.length, 0);
  const prefill = def.prefill?.(c) ?? {};

  /** Move a dragged task: new position, and the section when it crossed into another group. Undo puts it back (U1). */
  const moveTask = (moved: Task | undefined, patch: PatchTaskInput) => {
    if (!moved) return;
    const undo: PatchTaskInput = { position: moved.position, ...(patch.sectionId !== undefined ? { sectionId: moved.sectionId } : {}) };
    void update(moved.id, patch).then((res) => {
      if (res) toast({ message: `Moved “${moved.title}”`, action: { label: "Undo", run: () => void update(moved.id, undo) } });
    });
  };

  /** Drop the dragged task just above `target`, in its group `g`. */
  const dropOn = (target: Task, list: Task[], g: Group) => {
    if (!dragId || dragId === target.id) return;
    const rest = list.filter((t) => t.id !== dragId);
    const prev = rest[rest.findIndex((t) => t.id === target.id) - 1];
    const moved = c.byId.get(dragId);
    const patch: PatchTaskInput = { position: prev ? (prev.position + target.position) / 2 : target.position - 1 };
    if (g.sectionId !== undefined && moved && moved.sectionId !== g.sectionId) patch.sectionId = g.sectionId;
    moveTask(moved, patch);
    setDragId(null);
  };

  /** Drop the dragged task on a group's header: it goes to the end of that group. */
  const dropInto = (g: Group) => {
    const moved = dragId ? c.byId.get(dragId) : undefined;
    setDragId(null);
    setOverId(null);
    if (!moved || g.sectionId === undefined || moved.sectionId === g.sectionId) return;
    moveTask(moved, { sectionId: g.sectionId, position: (g.tasks[g.tasks.length - 1]?.position ?? 0) + 1 });
  };

  const parentTitle = (t: Task) => (t.parentId ? (c.byId.get(t.parentId)?.title ?? null) : null);

  /**
   * Alt+↑ / Alt+↓ (U2): the keyboard version of a drag, the same server call
   * (a new position between the neighbours), with Undo. Focus stays on it.
   */
  const moveBy = (t: Task, list: Task[], dir: -1 | 1) => {
    const i = list.findIndex((x) => x.id === t.id);
    const target = list[i + dir];
    if (i < 0 || !target) return;
    const beyond = list[i + 2 * dir];
    const position = beyond ? (target.position + beyond.position) / 2 : target.position + dir;
    void update(t.id, { position }).then((res) => {
      if (res) toast({ message: `Moved “${t.title}”`, action: { label: "Undo", run: () => void update(t.id, { position: t.position }) } });
    });
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-task-row="${CSS.escape(t.id)}"]`)?.focus());
  };
  // A collapsed section hides its rows: Tab must land on one that is shown.
  const shown = groups.filter((g) => !g.section?.collapsed);
  const firstOpenId = shown.find((g) => g.tasks.length)?.tasks[0]?.id ?? null;
  const tabTaskId = focusTaskId && shown.some((g) => g.tasks.some((t) => t.id === focusTaskId)) ? focusTaskId : firstOpenId;

  return (
    <Page
      title={def.title}
      icon={def.icon}
      actions={
        <>
          {def.actions}
          <button type="button" onClick={() => setShowDone((s) => !s)} className={btn.ghost} aria-pressed={showDone} aria-label={showDone ? "Hide completed" : "Show completed"} title={showDone ? "Hide completed" : "Show completed"}>
            <Icon name="circleCheck" size={14} />
            <span className="hidden sm:inline">{showDone ? "Hide completed" : "Show completed"}</span>
          </button>
          <button type="button" onClick={() => openCompose(prefill)} className={btn.primary} aria-label="New task">
            <Icon name="plus" size={14} />
            <span className="hidden sm:inline">New task</span>
          </button>
        </>
      }
    >
      <TaskErrorBanner />
      {def.banner}
      {!loaded ? (
        <p className="p-6 text-muted">Loading tasks…</p>
      ) : openCount === 0 && (!showDone || done.length === 0) && !groups.some((g) => g.keepEmpty) ? (
        <EmptyHint
          icon={def.empty.icon}
          title={def.empty.title}
          hint={def.empty.hint}
          action={
            <button type="button" onClick={() => openCompose(prefill)} className={btn.outline}>
              <Icon name="plus" size={14} />
              New task
            </button>
          }
        />
      ) : (
        <>
          {groups.map((g) => (
            <GroupSection
              key={g.key}
              title={g.title}
              count={g.tasks.length}
              collapse={g.section ? { collapsed: g.section.collapsed, toggle: () => void updateSection(g.section!.id, { collapsed: !g.section!.collapsed }) } : undefined}
              actions={g.actions}
              drop={
                def.manual && !showDone && g.sectionId !== undefined && dragId
                  ? { onDrop: () => dropInto(g), over: overId === `h:${g.key}`, setOver: (v) => setOverId(v ? `h:${g.key}` : null) }
                  : undefined
              }
            >
              {g.tasks.map((t) => (
                <TaskRow
                  key={t.id}
                  task={t}
                  today={today}
                  now={now}
                  hideProject={def.hideProject}
                  parentTitle={def.withSubtasks ? parentTitle(t) : null}
                  subs={subs.get(t.id)}
                  tabbable={t.id === tabTaskId}
                  onFocusRow={() => setFocusTaskId(t.id)}
                  onMove={def.manual && !showDone ? (dir) => moveBy(t, g.tasks, dir) : undefined}
                  drag={
                    def.manual && !showDone
                      ? {
                          onDragStart: () => setDragId(t.id),
                          onDragEnd: () => {
                            setDragId(null);
                            setOverId(null);
                          },
                          onDrop: () => dropOn(t, g.tasks, g),
                          over: overId === t.id && dragId !== t.id,
                          setOver: (v) => setOverId(v ? t.id : null),
                          touchOver: setOverId,
                          touchDrop: (id) => {
                            // The row under the finger may sit in another section.
                            const tg = groups.find((x) => x.tasks.some((y) => y.id === id));
                            const target = tg?.tasks.find((x) => x.id === id);
                            if (tg && target) dropOn(target, tg.tasks, tg);
                            setDragId(null);
                            setOverId(null);
                          },
                        }
                      : undefined
                  }
                />
              ))}
            </GroupSection>
          ))}
          {showDone && done.length > 0 && (
            <GroupSection title="Completed" count={done.length}>
              {done.map((t) => (
                <TaskRow key={t.id} task={t} today={today} now={now} hideProject={def.hideProject} subs={subs.get(t.id)} />
              ))}
            </GroupSection>
          )}
        </>
      )}
      {loaded && def.footer}
    </Page>
  );
}

// --- the views -----------------------------------------------------------------

/**
 * Inbox: the capture list, the open tasks with no project, filterable by label.
 * A task leaves it once it has a project; Today and Upcoming show tasks across
 * projects by date. Same definition as Tidy Inbox and Plan my day.
 */
export function TaskInboxPage() {
  const { labels } = useTasks();
  const router = useRouter();
  const params = useSearchParams();
  const label = params.get("label");
  const setParam = useCallback(
    (k: string, v: string) => {
      const u = new URL(window.location.href);
      if (v) u.searchParams.set(k, v);
      else u.searchParams.delete(k);
      router.replace(`${u.pathname}${u.search}`);
    },
    [router],
  );
  const select = "h-7 rounded-md border border-line bg-surface px-1.5 text-[12.5px] text-muted outline-none";
  // Stable between renders (v5 3.10): a new `def` each render made TaskList's memo recompute on every drag-over.
  const def = useMemo<ViewDef>(() => ({
    title: "Inbox",
    icon: <Icon name="inbox" size={15} />,
    filter: (t) => t.projectId == null && (!label || t.labels.includes(label)),
    group: (open, c) => overdueSplit(open, c.today, "Upcoming & no date"),
    prefill: () => ({ projectId: null }),
    empty: { title: "Inbox zero", hint: "Tasks without a project show up here.", icon: "inbox" },
    actions: (
      <>
        {labels.length > 0 && (
          <select aria-label="Filter by label" value={label ?? ""} onChange={(e) => setParam("label", e.target.value)} className={select}>
            <option value="">Any label</option>
            {labels.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        )}
        <TidyInbox />
      </>
    ),
  }), [label, labels, setParam]);
  return <TaskList def={def} />;
}

/** Overdue plus due today (§12.8). */
const TODAY_DEF: ViewDef = {
  title: "Today",
  icon: <Icon name="star" size={15} />,
  withSubtasks: true,
  filter: (t, c) => t.dueDate != null && t.dueDate <= c.today,
  group: (open, c) => {
    const overdue = open.filter((t) => t.dueDate! < c.today);
    return [
      ...(overdue.length ? [{ key: "overdue", title: "Overdue", tasks: overdue }] : []),
      { key: "today", title: "Today", tasks: open.filter((t) => t.dueDate === c.today) },
    ];
  },
  prefill: (c) => ({ dueDate: c.today }),
  empty: { title: "Nothing due today", hint: "Tasks due today and overdue ones show up here.", icon: "star" },
  actions: <PlanMyDay />,
};

export function TaskTodayPage() {
  return <TaskList def={TODAY_DEF} />;
}

/** The next 14 days, by day, with overdue on top (§12.8). */
const UPCOMING_DEF: ViewDef = {
  title: "Upcoming",
  icon: <Icon name="calendar" size={15} />,
  withSubtasks: true,
  filter: (t, c) => t.dueDate != null && t.dueDate < addDays(c.today, 14),
  group: (open, c) => {
    const overdue = open.filter((t) => t.dueDate! < c.today);
    const days: Group[] = Array.from({ length: 14 }, (_, i) => {
      const d = addDays(c.today, i);
      const pretty = new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
      return { key: d, title: i < 2 ? `${dueLabel(d, c.today).text} · ${pretty}` : pretty, tasks: open.filter((t) => t.dueDate === d), keepEmpty: true };
    });
    return [...(overdue.length ? [{ key: "overdue", title: "Overdue", tasks: overdue }] : []), ...days];
  },
  prefill: (c) => ({ dueDate: c.today }),
  empty: { title: "Nothing coming up", hint: "Tasks due in the next two weeks show up here.", icon: "calendar" },
};

export function TaskUpcomingPage() {
  return <TaskList def={UPCOMING_DEF} />;
}

/** One of my projects, in manual order (§12.3, §12.8). */
export function TaskProjectPage({ id }: { id: string }) {
  const { projects, tasks, sections, loaded, updateProject, updateSection, openCompose } = useTasks();
  const [editing, setEditing] = useState(false);
  // Naming a new section or renaming one; asking before deleting one.
  const [naming, setNaming] = useState<TaskSection | "new" | null>(null);
  const [deleting, setDeleting] = useState<TaskSection | null>(null);
  const project = projects.find((p) => p.id === id);
  const placed = useMemo(() => tasks.filter((t) => t.projectId === id), [tasks, id]);
  const mine = useMemo(() => sections.filter((s) => s.projectId === id).sort((a, b) => a.position - b.position), [sections, id]);
  const def = useMemo<ViewDef | null>(() => (project ? {
          title: project.name,
          icon: <ColorDot color={project.color} size={10} />,
          withArchived: true,
          manual: true,
          hideProject: true,
          filter: (t) => t.projectId === id,
          // With GitHub items below, an empty project still shows its Tasks header.
          group: (open) => {
            // Without sections this is the one list it always was; with them, tasks in no section come first.
            if (!mine.length) return [{ key: project.source ? "tasks" : "all", title: "Tasks", tasks: open, keepEmpty: Boolean(project.source) }];
            return [
              { key: "none", title: "Tasks", tasks: open.filter((t) => !t.sectionId || !mine.some((s) => s.id === t.sectionId)), keepEmpty: true, sectionId: null },
              ...mine.map((s, i) => ({
                key: `s:${s.id}`,
                title: s.name,
                tasks: open.filter((t) => t.sectionId === s.id),
                keepEmpty: true,
                sectionId: s.id,
                section: s,
                actions: (
                  <SectionMenu
                    section={s}
                    first={i === 0}
                    last={i === mine.length - 1}
                    onRename={() => setNaming(s)}
                    onDelete={() => setDeleting(s)}
                    onMove={(dir) => {
                      const position = movedPosition(mine, s.id, dir);
                      if (position != null) void updateSection(s.id, { position });
                    }}
                    onAddTask={() => openCompose({ projectId: id, sectionId: s.id })}
                  />
                ),
              })),
            ];
          },
          prefill: () => ({ projectId: id }),
          empty: { title: "No tasks here yet", hint: "Add one, or move tasks here from the task panel. Drag to reorder.", icon: "list" },
          banner: project.archived ? (
            <div className="flex items-center gap-2 border-b border-line bg-banner-warning px-4 py-2 text-[12.5px] text-warning">
              <Icon name="box" size={13} />
              <span className="flex-1">Archived: its tasks are hidden from Inbox, Today and Upcoming.</span>
              <button type="button" onClick={() => void updateProject(id, { archived: false })} className={btn.outline}>
                Unarchive
              </button>
            </div>
          ) : null,
          footer: <ProjectSourceSection project={project} tasks={placed} />,
          actions: (
            <>
              {!project.archived && (
                <button type="button" onClick={() => setNaming("new")} className={btn.ghost}>
                  <Icon name="plus" size={13} /> Add section
                </button>
              )}
              {!project.source && (
                <button
                  type="button"
                  onClick={() => void updateProject(id, { source: NEW_SOURCE })}
                  className={btn.ghost}
                  title="Show GitHub issues that match a filter in this project"
                >
                  <Icon name="git" size={13} /> Pull in from GitHub
                </button>
              )}
              <button type="button" onClick={() => setEditing(true)} className={btn.ghost}>
                <Icon name="sliders" size={13} /> Edit
              </button>
              {!project.archived && (
                <button type="button" onClick={() => void updateProject(id, { archived: true })} className={btn.ghost}>
                  <Icon name="box" size={13} /> Archive
                </button>
              )}
            </>
          ),
        } : null), [project, id, placed, mine, updateProject, updateSection, openCompose]);
  if (!project || !def) {
    return loaded ? <EmptyHint icon="list" title="Project not found" hint="It doesn't exist, or it belongs to someone else." /> : <p className="p-6 text-muted">Loading…</p>;
  }
  return (
    <>
      <TaskList def={def} />
      <ProjectDialog open={editing} onClose={() => setEditing(false)} project={project} />
      <SectionDialog open={naming != null} onClose={() => setNaming(null)} projectId={id} section={naming === "new" ? null : naming} />
      <DeleteSectionDialog section={deleting} onClose={() => setDeleting(null)} />
    </>
  );
}

/** Tasks with one of my labels (§12.3). */
export function TaskLabelPage({ id }: { id: string }) {
  const { labels, loaded } = useTasks();
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const label = labels.find((l) => l.id === id);
  const def = useMemo<ViewDef | null>(() => (label ? {
          title: label.name,
          icon: <ColorDot color={label.color} size={9} shape="tag" />,
          withSubtasks: true,
          filter: (t) => t.labels.includes(id),
          group: (open, c) => overdueSplit(open, c.today, "Upcoming & no date"),
          empty: { title: `Nothing labelled “${label.name}”`, hint: "Add the label in quick add (+name) or from the task panel.", icon: "tag" },
          actions: (
            <button type="button" onClick={() => setEditing(true)} className={btn.ghost}>
              <Icon name="sliders" size={13} /> Edit
            </button>
          ),
        } : null), [label, id]);
  if (!label || !def) {
    return loaded ? <EmptyHint icon="tag" title="Label not found" hint="It was deleted, or it belongs to someone else." /> : <p className="p-6 text-muted">Loading…</p>;
  }
  return (
    <>
      <TaskList def={def} />
      <LabelDialog open={editing} onClose={() => setEditing(false)} label={label} onDeleted={() => router.push("/tasks")} />
    </>
  );
}

/** A saved task view (item 12): the Tasks list with the view's filters. */
export function TaskSavedViewPage({ id }: { id: string }) {
  const { taskViews, removeTaskView } = useAppViews();
  const router = useRouter();
  const { toast } = useToast();
  const [deleting, setDeleting] = useState(false);
  const view = taskViews.find((v) => v.id === id);
  const def = useMemo<ViewDef | null>(
    () =>
      view
        ? {
            title: view.name,
            icon: <Icon name="sliders" size={15} />,
            // The Inbox view matches a sub-task whose own project is null:
            // the Inbox page and badge keep those out.
            withSubtasks: taskViewShowsSubtasks(view.filter),
            filter: (t, c) => taskViewMatches(t, view.filter, c.today),
            // A project view is one list; any other view splits overdue from the rest like Inbox.
            group: (open, c) =>
              view.filter.projectId && view.filter.projectId !== "none" ? [{ key: "all", title: "Tasks", tasks: open }] : overdueSplit(open, c.today, "Upcoming & no date"),
            prefill: () => taskViewPrefill(view.filter),
            empty: { title: "No tasks match", hint: "Save a view with different filters.", icon: "sliders" },
            actions: (
              <button type="button" onClick={() => setDeleting(true)} className={btn.ghost}>
                <Icon name="trash" size={13} /> Delete view
              </button>
            ),
          }
        : null,
    [view],
  );
  if (!view || !def) {
    return <EmptyHint icon="sliders" title="View not found" hint="It was deleted, or it never existed." />;
  }
  return (
    <>
      <TaskList def={def} />
      <Dialog open={deleting} onClose={() => setDeleting(false)} label="Delete view" width={420}>
        <div className="p-4">
          <p className="text-[14px] font-semibold">Delete “{view.name}”?</p>
          <p className="mt-1 text-[12.5px] text-muted">Its tasks stay where they are; only the saved view goes.</p>
          <div className="mt-4 flex justify-end gap-1.5">
            <button type="button" onClick={() => setDeleting(false)} className={btn.ghost}>
              Cancel
            </button>
            <button
              type="button"
              onClick={() =>
                void removeTaskView(view.id).then((ok) => {
                  setDeleting(false);
                  if (!ok) return;
                  toast({ message: "View deleted." });
                  router.push("/tasks");
                })
              }
              className={btn.outline}
            >
              Delete
            </button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
