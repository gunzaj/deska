"use client";

import { fetchPreloaded } from "@/lib/client/preload";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { isUnauthorized } from "@/lib/client/session";
import { usePoll } from "@/lib/client/poll";
import type { CreateTaskInput, PatchTaskInput, Task, TaskLabel, TaskProject, TaskSection } from "@/lib/tasks/model";
import { Dialog } from "../ui/dialog";
import { useToast } from "../ui/toast";
import { btn } from "../ui/popover";

/** What quick add opens with: the issue it came from, the view's project or date (§12.4). */
export type ComposePrefill = { links?: number[]; projectId?: string | null; sectionId?: string | null; dueDate?: string | null; parentId?: string | null };

type CreateInput = Partial<CreateTaskInput> & { title: string };

/**
 * Browser-side task state. Loads every task the viewer can see once, keeps it
 * fresh while the tab is visible (so tasks assigned by a colleague appear),
 * and applies edits optimistically, rolling back if the server refuses.
 */
type TasksCtx = {
  tasks: Task[];
  projects: TaskProject[];
  labels: TaskLabel[];
  sections: TaskSection[];
  loaded: boolean;
  error: string | null;
  clearError: () => void;
  create: (input: CreateInput) => Promise<Task | null>;
  update: (id: string, patch: PatchTaskInput) => Promise<{ task: Task; descriptionHtml: string } | null>;
  /** Complete or reopen; asks first when completing a parent with open sub-tasks (§12.1). */
  toggleComplete: (task: Task) => void;
  remove: (id: string) => Promise<boolean>;
  reload: () => Promise<void>;
  createProject: (name: string, color: string) => Promise<TaskProject | null>;
  updateProject: (id: string, patch: Partial<Omit<TaskProject, "id">>) => Promise<boolean>;
  createSection: (projectId: string, name: string) => Promise<TaskSection | null>;
  updateSection: (id: string, patch: Partial<Pick<TaskSection, "name" | "position" | "collapsed">>) => Promise<boolean>;
  /** Its tasks stay in the project, without a section. */
  deleteSection: (id: string) => Promise<boolean>;
  updateLabel: (id: string, patch: Partial<Omit<TaskLabel, "id">>) => Promise<boolean>;
  deleteLabel: (id: string) => Promise<boolean>;
  /** Both are stable; the compose dialog's own state is in `useComposeState` so opening it re-renders no task list. */
  openCompose: (prefill?: ComposePrefill) => void;
  closeCompose: () => void;
};

/** The compose dialog's state: only the dialog reads it (v5 3.10). */
type ComposeState = { composeOpen: boolean; composePrefill: ComposePrefill };

const Ctx = createContext<TasksCtx | null>(null);
const ComposeContext = createContext<ComposeState | null>(null);

export function useComposeState(): ComposeState {
  const c = useContext(ComposeContext);
  if (!c) throw new Error("useComposeState outside TasksProvider");
  return c;
}

export function useTasks(): TasksCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useTasks outside TasksProvider");
  return c;
}

const REFRESH_MS = 60_000;
/** Channel the quick-add window uses to tell the main window a task was saved. */
export const TASKS_CHANGED = "deska:tasks-changed";

async function errorOf(res: Response): Promise<string> {
  const body = await res.json().catch(() => null);
  return body?.error ?? `HTTP ${res.status}`;
}

const json = (method: string, body: unknown): RequestInit => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export function TasksProvider({ children }: { children: ReactNode }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<TaskProject[]>([]);
  const [labels, setLabels] = useState<TaskLabel[]>([]);
  const [sections, setSections] = useState<TaskSection[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [composePrefill, setComposePrefill] = useState<ComposePrefill>({});
  const [confirmParent, setConfirmParent] = useState<{ task: Task; open: number } | null>(null);
  const { toast } = useToast();
  const lastLoad = useRef(0);
  // Latest committed list, so callbacks stay stable and never act on a stale closure.
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;
  const sectionsRef = useRef(sections);
  sectionsRef.current = sections;
  // Edits in flight: a reload that lands meanwhile must not overwrite them, so
  // it is dropped and repeated once the last edit settles.
  const pending = useRef(0);
  const stale = useRef(false);
  // Each load gets a number; only the newest may apply. An edit bumps it too,
  // since a load sent before the edit reached the server may predate it.
  const loadSeq = useRef(0);
  const loading = useRef(false);

  const reload = useCallback(async () => {
    const seq = ++loadSeq.current;
    loading.current = true;
    try {
      const res = await fetchPreloaded("/api/tasks", { cache: "no-store" });
      if (isUnauthorized(res)) return;
      if (!res.ok) throw new Error(await errorOf(res));
      const body = (await res.json()) as { tasks: Task[]; projects: TaskProject[]; labels: TaskLabel[]; sections: TaskSection[] };
      if (seq !== loadSeq.current) return;
      lastLoad.current = Date.now();
      if (pending.current > 0) {
        stale.current = true;
        return;
      }
      setTasks(body.tasks);
      setProjects(body.projects);
      setLabels(body.labels);
      setSections(body.sections ?? []);
      setLoaded(true);
    } catch (e) {
      if (seq === loadSeq.current) setError(`Could not load tasks: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      if (seq === loadSeq.current) loading.current = false;
    }
  }, []);

  usePoll(reload, { every: 15_000, minGap: REFRESH_MS, lastRun: lastLoad });

  // The floating quick-add window is another window with its own page: it says
  // so when it saves, instead of leaving this one to find the task on the poll.
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const ch = new BroadcastChannel(TASKS_CHANGED);
    ch.onmessage = () => void reload();
    return () => ch.close();
  }, [reload]);

  const settle = useCallback(() => {
    pending.current--;
    if (pending.current === 0 && stale.current) {
      stale.current = false;
      void reload();
    }
  }, [reload]);

  /**
   * Run a request that changes task data; reports failures in the error
   * banner. A 409 goes to `onConflict` instead, when given (S9).
   */
  const send = useCallback(
    async <T,>(url: string, init: RequestInit, what: string, onConflict?: (body: unknown) => void): Promise<T | null> => {
      pending.current++;
      if (loading.current) {
        // Drop the load already on its way; settle() reloads after this edit.
        loadSeq.current++;
        loading.current = false;
        stale.current = true;
      }
      try {
        const res = await fetch(url, init);
        if (isUnauthorized(res)) return null;
        if (res.status === 409 && onConflict) {
          onConflict(await res.json().catch(() => null));
          return null;
        }
        if (!res.ok) throw new Error(await errorOf(res));
        return (await res.json()) as T;
      } catch (e) {
        setError(`Could not ${what}: ${e instanceof Error ? e.message : String(e)}`);
        return null;
      } finally {
        settle();
      }
    },
    [settle],
  );

  /** Put the server's copy of a task in the list, unless a newer write already landed. */
  const replace = useCallback(
    (task: Task) =>
      setTasks((prev) => {
        const cur = prev.find((t) => t.id === task.id);
        if (!cur) return [...prev, task];
        // Concurrent PATCHes can answer out of order; keep the later server state.
        if (cur.updatedAt > task.updatedAt) return prev;
        return prev.map((t) => (t.id === task.id ? task : t));
      }),
    [],
  );

  /** Merge fields into tasks by ID; later optimistic edits to other fields survive. */
  const patchLocal = useCallback((changes: Map<string, Partial<Task>>) => {
    if (changes.size) setTasks((prev) => prev.map((t) => (changes.has(t.id) ? { ...t, ...changes.get(t.id) } : t)));
  }, []);

  // A task write can create labels on the fly (`+label`); pick them up.
  const refreshLabels = useCallback(
    (names: string[] | undefined) => {
      if (names?.length) void reload();
    },
    [reload],
  );

  const create = useCallback(
    async (input: CreateInput) => {
      const body = await send<{ task: Task }>("/api/tasks", json("POST", input), "create task");
      if (!body) return null;
      replace(body.task);
      refreshLabels(input.labels);
      return body.task;
    },
    [send, replace, refreshLabels],
  );

  // PATCHes to one task go out one at a time (S9). Each carries the task's
  // updatedAt the edit was based on; when an earlier edit from this tab moved
  // it on, a different edit is rebased onto the new version, since our own
  // change is not a conflict. An identical edit (a double-click) is not, so
  // the server refuses the second one with 409.
  const queues = useRef(new Map<string, Promise<unknown>>());
  const applied = useRef(new Map<string, { from: string; to: string; patch: string }[]>());

  const update = useCallback(
    async (id: string, patch: PatchTaskInput) => {
      const before = tasksRef.current.find((t) => t.id === id);
      const basedOn = before?.updatedAt;
      // Only the fields this patch touches are applied and rolled back, so two
      // quick edits (e.g. clearing date and time) don't undo each other.
      const optimistic = new Map<string, Partial<Task>>();
      const rollback = new Map<string, Partial<Task>>();
      const recurs = Boolean(patch.completed && before?.recurrence && !patch.endRecurrence);
      if (before) {
        const o: Partial<Task> = {};
        if (patch.title !== undefined) o.title = patch.title;
        if (patch.description !== undefined) o.description = patch.description;
        if (patch.priority !== undefined) o.priority = patch.priority;
        if (patch.dueDate !== undefined) o.dueDate = patch.dueDate;
        if (patch.dueTime !== undefined) o.dueTime = patch.dueTime;
        // No date, no time or recurrence (the server does the same).
        if (patch.dueDate === null) Object.assign(o, { dueTime: null, recurrence: null });
        if (patch.recurrence !== undefined) o.recurrence = patch.recurrence;
        if (patch.projectId !== undefined) o.projectId = patch.projectId;
        // Another project drops the old section, unless the patch names one (the server does the same).
        if (patch.sectionId !== undefined) o.sectionId = patch.sectionId;
        else if (patch.projectId !== undefined && patch.projectId !== before.projectId) o.sectionId = null;
        if (patch.position !== undefined) o.position = patch.position;
        // A recurring task doesn't close: the server moves its date instead (§12.5).
        if (patch.completed !== undefined && !recurs) o.completedAt = patch.completed ? new Date().toISOString() : null;
        optimistic.set(id, o);
        rollback.set(id, Object.fromEntries(Object.keys(o).map((k) => [k, before[k as keyof Task]])) as Partial<Task>);
        if (patch.cascade && patch.completed) {
          const now = new Date().toISOString();
          for (const c of tasksRef.current) {
            if (c.parentId !== id || c.completedAt) continue;
            optimistic.set(c.id, { completedAt: now });
            rollback.set(c.id, { completedAt: null });
          }
        }
        patchLocal(optimistic);
      }
      const patchKey = JSON.stringify(patch);
      const run = async () => {
        let expected = basedOn;
        for (const step of applied.current.get(id) ?? []) if (expected === step.from && step.patch !== patchKey) expected = step.to;
        let conflict: { task: Task } | null = null;
        const res = await send<{ task: Task; descriptionHtml: string }>(
          `/api/tasks/${id}`,
          json("PATCH", expected ? { ...patch, expectedUpdatedAt: expected } : patch),
          "save task",
          (b) => (conflict = (b as { current?: { task: Task } } | null)?.current ?? null),
        );
        if (res && expected) applied.current.set(id, [...(applied.current.get(id) ?? []).slice(-9), { from: expected, to: res.task.updatedAt, patch: patchKey }]);
        return { res, conflict: conflict as { task: Task } | null };
      };
      const queued = (queues.current.get(id) ?? Promise.resolve()).then(run, run);
      queues.current.set(id, queued);
      const { res: body, conflict } = await queued;
      if (queues.current.get(id) === queued) queues.current.delete(id);
      if (!body) {
        patchLocal(rollback);
        if (conflict) {
          // Changed in another tab or by someone else: show their version. A
          // repeat of this tab's own last edit (a double-click) is not news.
          const repeat = (applied.current.get(id) ?? []).some((st) => st.from === basedOn && st.patch === patchKey);
          // Overwrite only the fields this edit touched: other optimistic
          // edits the user has since made must survive.
          const changed = optimistic.get(id);
          const server = conflict!.task as unknown as Record<string, unknown>;
          setTasks((prev) =>
            prev.map((t) => {
              if (t.id !== id) return t;
              if (!changed) return conflict!.task;
              const merged = { ...t } as unknown as Record<string, unknown>;
              for (const k of Object.keys(changed)) merged[k] = server[k];
              return merged as unknown as typeof t;
            }),
          );
          if (!repeat) toast({ message: "Task changed elsewhere. Showing the latest version." });
          void reload();
        }
        return null;
      }
      replace(body.task);
      // Completing a recurring task also reopens its sub-tasks on the server.
      if (recurs) void reload();
      else refreshLabels(patch.labels);
      return body;
    },
    [send, replace, patchLocal, refreshLabels, reload, toast],
  );

  /**
   * Complete a task and offer Undo (U1). A recurring task's undo puts the
   * date back and drops the logged occurrence; a cascade's undo reopens the
   * sub-tasks it closed.
   */
  const complete = useCallback(
    async (task: Task, cascade?: boolean) => {
      const closedChildren = cascade ? tasksRef.current.filter((t) => t.parentId === task.id && !t.completedAt).map((t) => t.id) : [];
      const res = await update(task.id, cascade === undefined ? { completed: true } : { completed: true, cascade });
      if (!res) return;
      const recurring = Boolean(task.recurrence && task.dueDate);
      // An occurrence another tab had already logged didn't move: nothing to undo.
      if (recurring && res.task.dueDate === task.dueDate) return;
      toast({
        message: recurring ? `Completed “${task.title}”, next on ${res.task.dueDate}` : `Completed “${task.title}”`,
        action: {
          label: "Undo",
          run: async () => {
            if (recurring) await update(task.id, { undoOccurrence: task.dueDate! });
            else await update(task.id, { completed: false });
            for (const id of closedChildren) await update(id, { completed: false });
          },
        },
      });
    },
    [update, toast],
  );

  const toggleComplete = useCallback(
    (task: Task) => {
      if (task.completedAt) {
        void update(task.id, { completed: false });
        return;
      }
      const open = tasksRef.current.filter((t) => t.parentId === task.id && !t.completedAt).length;
      if (open > 0) setConfirmParent({ task, open });
      else void complete(task);
    },
    [update, complete],
  );

  /** Undo a delete (U1): the server brings back the task with its links, labels and sub-tasks. */
  const restore = useCallback(
    async (id: string) => {
      const body = await send<{ task: Task }>(`/api/tasks/${id}/restore`, { method: "POST" }, "restore task");
      if (!body) return false;
      replace(body.task);
      // Sub-tasks, placements and labels come back too: reload the lot.
      void reload();
      return true;
    },
    [send, replace, reload],
  );

  const remove = useCallback(
    async (id: string) => {
      const gone = tasksRef.current.filter((t) => t.id === id || t.parentId === id);
      const title = gone.find((t) => t.id === id)?.title ?? "task";
      setTasks((prev) => prev.filter((t) => t.id !== id && t.parentId !== id));
      const ok = await send<{ ok: true }>(`/api/tasks/${id}`, { method: "DELETE" }, "delete task");
      // Put back only what was removed, keeping anything that changed meanwhile.
      if (!ok) setTasks((prev) => [...prev, ...gone.filter((g) => !prev.some((t) => t.id === g.id))]);
      else toast({ message: `Deleted “${title}”`, action: { label: "Undo", run: () => void restore(id) } });
      return Boolean(ok);
    },
    [send, toast, restore],
  );

  const createProject = useCallback(
    async (name: string, color: string) => {
      const p = await send<TaskProject>("/api/task-projects", json("POST", { name, color }), "create project");
      if (p) setProjects((prev) => [...prev, p]);
      return p;
    },
    [send],
  );

  const updateProject = useCallback(
    async (id: string, patch: Partial<Omit<TaskProject, "id">>) => {
      const p = await send<TaskProject>(`/api/task-projects/${id}`, json("PATCH", patch), "update project");
      if (p) setProjects((prev) => prev.map((x) => (x.id === id ? p : x)).sort((a, b) => a.position - b.position));
      return Boolean(p);
    },
    [send],
  );

  const createSection = useCallback(
    async (projectId: string, name: string) => {
      const s = await send<TaskSection>("/api/task-sections", json("POST", { projectId, name }), "create section");
      if (s) setSections((prev) => [...prev, s].sort((a, b) => a.position - b.position));
      return s;
    },
    [send],
  );

  const updateSection = useCallback(
    async (id: string, patch: Partial<Pick<TaskSection, "name" | "position" | "collapsed">>) => {
      // Collapsing and reordering show at once; the server's copy replaces it.
      const before = sectionsRef.current.find((x) => x.id === id);
      setSections((prev) => prev.map((x) => (x.id === id ? { ...x, ...patch } : x)).sort((a, b) => a.position - b.position));
      const s = await send<TaskSection>(`/api/task-sections/${id}`, json("PATCH", patch), "update section");
      if (s) setSections((prev) => prev.map((x) => (x.id === id ? s : x)).sort((a, b) => a.position - b.position));
      else if (before) setSections((prev) => prev.map((x) => (x.id === id ? before : x)).sort((a, b) => a.position - b.position));
      return Boolean(s);
    },
    [send],
  );

  const deleteSection = useCallback(
    async (id: string) => {
      const ok = await send<{ ok: true }>(`/api/task-sections/${id}`, { method: "DELETE" }, "delete section");
      if (ok) {
        setSections((prev) => prev.filter((x) => x.id !== id));
        setTasks((prev) => prev.map((t) => (t.sectionId === id ? { ...t, sectionId: null } : t)));
      }
      return Boolean(ok);
    },
    [send],
  );

  const updateLabel = useCallback(
    async (id: string, patch: Partial<Omit<TaskLabel, "id">>) => {
      const l = await send<TaskLabel>(`/api/task-labels/${id}`, json("PATCH", patch), "update label");
      if (l) setLabels((prev) => prev.map((x) => (x.id === id ? l : x)).sort((a, b) => a.name.localeCompare(b.name)));
      return Boolean(l);
    },
    [send],
  );

  const deleteLabel = useCallback(
    async (id: string) => {
      const ok = await send<{ ok: true }>(`/api/task-labels/${id}`, { method: "DELETE" }, "delete label");
      if (ok) {
        setLabels((prev) => prev.filter((x) => x.id !== id));
        setTasks((prev) => prev.map((t) => (t.labels.includes(id) ? { ...t, labels: t.labels.filter((x) => x !== id) } : t)));
      }
      return Boolean(ok);
    },
    [send],
  );

  const openCompose = useCallback((prefill?: ComposePrefill) => {
    setComposePrefill(prefill ?? {});
    setComposeOpen(true);
  }, []);
  const closeCompose = useCallback(() => setComposeOpen(false), []);
  const clearError = useCallback(() => setError(null), []);

  const value = useMemo<TasksCtx>(
    () => ({
      tasks,
      projects,
      labels,
      sections,
      loaded,
      error,
      clearError,
      create,
      update,
      toggleComplete,
      remove,
      reload,
      createProject,
      updateProject,
      createSection,
      updateSection,
      deleteSection,
      updateLabel,
      deleteLabel,
      openCompose,
      closeCompose,
    }),
    [tasks, projects, labels, sections, loaded, error, clearError, create, update, toggleComplete, remove, reload, createProject, updateProject, createSection, updateSection, deleteSection, updateLabel, deleteLabel, openCompose, closeCompose],
  );
  const composeValue = useMemo<ComposeState>(() => ({ composeOpen, composePrefill }), [composeOpen, composePrefill]);

  const finish = (cascade: boolean) => {
    if (confirmParent) void complete(confirmParent.task, cascade);
    setConfirmParent(null);
  };

  return (
    <Ctx.Provider value={value}>
      <ComposeContext.Provider value={composeValue}>
      {children}
      <Dialog open={confirmParent != null} onClose={() => setConfirmParent(null)} label="Complete task" width={420}>
        <div className="p-4">
          <p className="text-[14px] font-semibold">Complete its sub-tasks too?</p>
          <p className="mt-1 text-muted">
            “{confirmParent?.task.title}” has {confirmParent?.open} open sub-task{confirmParent?.open === 1 ? "" : "s"}.
          </p>
          <div className="mt-4 flex justify-end gap-1.5">
            <button type="button" onClick={() => finish(false)} className={btn.outline}>
              Only this task
            </button>
            <button type="button" autoFocus onClick={() => finish(true)} className={btn.primary}>
              Complete all
            </button>
          </div>
        </div>
      </Dialog>
      </ComposeContext.Provider>
    </Ctx.Provider>
  );
}
