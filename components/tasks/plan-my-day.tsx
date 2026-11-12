"use client";

// "Plan my day" (SPEC §4.9, AI3): asks the model for one ordered plan for today
// and shows each item with its reason. Accepting a new date is a normal local task
// edit with Undo, "Add to tasks" creates a linked local task, and a row can be
// dismissed from the list. AI runs only when the user asks: opening the dialog
// reads today's stored plan and what a new one would be built from, and nothing is
// sent until "Plan my day" is clicked. Nothing changes until an item is accepted.
import { useCallback, useMemo, useRef, useState } from "react";
import { AI_FEATURES } from "@/lib/ai/features";
import { planNewDate, type PlanMyDaySuggestion } from "@/lib/ai/plan-my-day";
import type { PlanMyDayView } from "@/lib/ai/plan-my-day-service";
import type { Job } from "@/lib/ai/runner";
import { usePoll } from "@/lib/client/poll";
import { dueLabel } from "@/lib/tasks/dates";
import type { PatchTaskInput, Task } from "@/lib/tasks/model";
import { Elapsed } from "../ai/elapsed";
import { useAppData } from "../app/provider";
import { Icon } from "../icons";
import { Dialog } from "../ui/dialog";
import { btn } from "../ui/popover";
import { useToast } from "../ui/toast";
import { aiCall } from "./ai-task-assist";
import { useToday } from "./notifications";
import { useTasks } from "./store";

type Phase = "closed" | "loading" | "ready" | "running" | "done";

/** The plan on screen: a stored one, or the answer of the job the user just ran. */
type ShownPlan = { id: string | null; result: PlanMyDaySuggestion; fresh: boolean };

/** A task row: an existing open task, with the new date the plan gives it (or null). */
type TaskRow = {
  key: string;
  kind: "task";
  /** The plan item's id: the task's id. */
  id: string;
  title: string;
  reason: string;
  task: Task;
  next: { dueDate: string; dueTime: string | null } | null;
};

/** An issue row: an issue from the cache, with whether a local task already links it. */
type IssueRow = {
  key: string;
  kind: "issue";
  /** The plan item's id: the issue number as a string. */
  id: string;
  number: number;
  title: string;
  reason: string;
  linked: boolean;
};

type Row = TaskRow | IssueRow;

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** What a new plan is built from, as Settings → AI promises it (SPEC §4.9 "Minimal, visible input"). */
const SENDS = AI_FEATURES.find((f) => f.id === "plan-my-day")?.sends ?? "Your open tasks and the issues assigned to you in the current sprint.";

/**
 * The "Plan my day" button and dialog. The button sits in the Today page's
 * actions; the dialog reads today's stored plan and the candidates on open, runs
 * one job on request, and shows every item only after checking it against the
 * local task store and the issue cache.
 */
export function PlanMyDay() {
  const { tasks, create, remove, update } = useTasks();
  const { byNumber } = useAppData();
  const { today, now, tz } = useToday();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("closed");
  const [view, setView] = useState<PlanMyDayView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [jobError, setJobError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // Rows the user dismissed: hidden from the list only, never written anywhere.
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  // The job being polled, by id; a ref so the poll reads the latest one.
  const runningJob = useRef<string | null>(null);
  // A GET or a run started before this one must not fill the dialog.
  const seq = useRef(0);

  /** Record what the user did with a stored plan; the local change is already applied (SPEC §4.9). */
  const markOutcome = useCallback((id: string | null, outcome: "accepted" | "dismissed") => {
    if (id) void aiCall(`/api/ai/results/${id}/outcome`, "POST", { outcome }).catch(() => null);
  }, []);

  /** Open the dialog and read today's plan and candidates; nothing is sent to a model here. */
  const load = useCallback(async () => {
    const my = ++seq.current;
    runningJob.current = null;
    setOpen(true);
    setPhase("loading");
    setView(null);
    setLoadError(null);
    setJob(null);
    setJobError(null);
    setMessage(null);
    setRemoved(new Set());
    try {
      const body = (await aiCall(`/api/ai/plan-my-day?today=${encodeURIComponent(today)}`, "GET")) as unknown as PlanMyDayView;
      if (my !== seq.current) return;
      setView(body);
      setPhase("ready");
    } catch (e) {
      if (my !== seq.current) return;
      setLoadError(errorText(e));
      setPhase("ready");
    }
  }, [today]);

  const close = useCallback(() => {
    seq.current++;
    // Closing during a run would leave a model call going with nobody to show it.
    const id = runningJob.current;
    runningJob.current = null;
    if (id) void aiCall(`/api/ai/jobs/${id}/cancel`, "POST").catch(() => null);
    setOpen(false);
    setPhase("closed");
    setView(null);
    setLoadError(null);
    setJob(null);
    setJobError(null);
    setMessage(null);
    setRemoved(new Set());
  }, []);

  /** Ask for a new plan: the one action that sends the tasks and issues to the model. */
  const start = useCallback(async () => {
    const my = ++seq.current;
    runningJob.current = null;
    setJob(null);
    setJobError(null);
    setMessage(null);
    setPhase("running");
    try {
      const body = (await aiCall("/api/ai/plan-my-day", "POST", { today, now, tz })) as unknown as { job: Job };
      if (my !== seq.current) {
        // Closed or cancelled while the job was being queued: stop it unseen.
        void aiCall(`/api/ai/jobs/${body.job.id}/cancel`, "POST").catch(() => null);
        return;
      }
      if (body.job.state === "done" && body.job.result != null) {
        // A job that ended before the first poll is shown at once.
        setJob(body.job);
        setPhase("done");
        return;
      }
      if (body.job.state === "error") {
        setJobError(body.job.error?.message ?? "The plan failed.");
        setPhase("ready");
        return;
      }
      if (body.job.state === "cancelled") {
        setMessage("Cancelled.");
        setPhase("ready");
        return;
      }
      runningJob.current = body.job.id;
      setJob(body.job);
    } catch (e) {
      if (my !== seq.current) return;
      setJobError(errorText(e));
      setPhase("ready");
    }
  }, [today, now, tz]);

  const poll = useCallback(async () => {
    const id = runningJob.current;
    if (!id) return;
    try {
      const body = (await aiCall(`/api/ai/jobs/${id}`, "GET")) as unknown as { job: Job };
      if (runningJob.current !== id) return;
      if (body.job.state === "done" && body.job.result != null) {
        runningJob.current = null;
        setJob(body.job);
        setPhase("done");
      } else if (body.job.state === "error") {
        runningJob.current = null;
        setJobError(body.job.error?.message ?? "The plan failed.");
        setPhase("ready");
      } else if (body.job.state === "cancelled") {
        runningJob.current = null;
        setMessage("Cancelled.");
        setPhase("ready");
      }
    } catch {
      /* a transient poll failure: try again next tick */
    }
  }, []);
  usePoll(poll, { every: 800, enabled: phase === "running" });

  const cancel = useCallback(async () => {
    const id = runningJob.current;
    runningJob.current = null;
    seq.current++;
    setMessage("Cancelled.");
    setPhase("ready");
    if (id) await aiCall(`/api/ai/jobs/${id}/cancel`, "POST").catch(() => null);
  }, []);

  /** The plan on screen: the stored one, else the finished job's answer. */
  const plan = useMemo<ShownPlan | null>(() => {
    if (phase === "done" && job?.state === "done" && job.result != null) {
      return { id: job.resultId, result: job.result as PlanMyDaySuggestion, fresh: true };
    }
    if (view?.plan) return { id: view.plan.id, result: view.plan.result, fresh: view.plan.fresh };
    return null;
  }, [phase, job, view]);

  /**
   * The plan's items checked against the local data: only an open task that still
   * exists and an issue in the cache are shown. Nothing else can be accepted.
   */
  const rows = useMemo<Row[]>(() => {
    if (!plan) return [];
    const out: Row[] = [];
    const seen = new Set<string>();
    for (const item of plan.result.items) {
      const key = `${item.kind}:${item.id}`;
      if (seen.has(key) || removed.has(key)) continue;
      seen.add(key);
      if (item.kind === "task") {
        const task = tasks.find((t) => t.id === item.id);
        if (!task || task.completedAt) continue;
        const next = planNewDate({ dueDate: task.dueDate }, item, today);
        out.push({ key, kind: "task", id: item.id, title: task.title, reason: item.reason, task, next });
      } else {
        const number = Number(item.id);
        const issue = Number.isInteger(number) ? byNumber.get(number) : undefined;
        if (!issue) continue;
        out.push({ key, kind: "issue", id: item.id, number, title: issue.title, reason: item.reason, linked: tasks.some((t) => t.links.some((l) => l.number === number)) });
      }
    }
    return out;
  }, [plan, removed, tasks, byNumber, today]);

  /** Accept a new date: a normal local edit with Undo (SPEC §4.9). */
  const accept = useCallback(
    async (row: TaskRow) => {
      const next = row.next;
      if (!next) return;
      const task = row.task;
      const patch: PatchTaskInput = next.dueTime ? { dueDate: next.dueDate, dueTime: next.dueTime, tz } : { dueDate: next.dueDate, dueTime: null };
      const res = await update(task.id, patch);
      if (!res) return; // the store's error banner says why
      markOutcome(plan?.id ?? null, "accepted");
      const undo: PatchTaskInput = { dueDate: task.dueDate, dueTime: task.dueTime, ...(task.dueTz ? { tz: task.dueTz } : {}) };
      const label = dueLabel(next.dueDate, today).text;
      toast({ message: `Moved “${task.title}” to ${label}${next.dueTime ? ` ${next.dueTime}` : ""}`, action: { label: "Undo", run: () => void update(task.id, undo) } });
    },
    [plan, markOutcome, update, toast, today, tz],
  );

  /** Add a suggested issue to tasks as a linked local task, with Undo. */
  const addTask = useCallback(
    async (row: IssueRow) => {
      const created = await create({ title: row.title, links: [row.number] });
      if (!created) return; // the store's error banner says why
      markOutcome(plan?.id ?? null, "accepted");
      toast({ message: `Added “${row.title}” to tasks`, action: { label: "Undo", run: () => void remove(created.id) } });
    },
    [create, markOutcome, plan, remove, toast],
  );

  /** Drop one row from the list only; the plan itself is untouched. */
  const dismissRow = useCallback((row: Row) => {
    setRemoved((prev) => new Set(prev).add(row.key));
  }, []);

  /** Dismiss the whole stored plan and close (SPEC §4.9: a dismissed plan is not shown again). */
  const dismissPlan = useCallback(() => {
    markOutcome(plan?.id ?? null, "dismissed");
    close();
  }, [markOutcome, plan, close]);

  const count = view ? view.candidates.tasks + view.candidates.issues : 0;

  return (
    <>
      <button type="button" onClick={() => void load()} className={btn.ghost} data-ai-plan-open>
        <Icon name="zap" size={13} />
        Plan my day
      </button>
      <Dialog open={open} onClose={close} label="Plan my day" width={560}>
        <div className="space-y-3 p-4" data-ai-plan-dialog>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[14px] font-semibold">Plan my day</p>
              {view && (
                <p className="text-[12px] text-faint">
                  {view.candidates.tasks} task{view.candidates.tasks === 1 ? "" : "s"} and {view.candidates.issues} issue{view.candidates.issues === 1 ? "" : "s"} to plan from
                </p>
              )}
            </div>
            <button type="button" onClick={close} aria-label="Close" className={btn.icon}>
              <Icon name="x" size={15} />
            </button>
          </div>

          {phase === "loading" && (
            <p role="status" className="text-[12.5px] text-muted">
              Reading today&apos;s plan…
            </p>
          )}

          {phase === "ready" && loadError && (
            <div className="space-y-2">
              <p role="alert" className="text-[12.5px] text-critical">
                Could not read today&apos;s plan: {loadError}
              </p>
              <button type="button" onClick={() => void load()} className={btn.outline} data-ai-plan-retry>
                <Icon name="refresh" size={13} />
                Try again
              </button>
            </div>
          )}

          {phase === "ready" && view && !view.ai.ready && (
            <div className="space-y-2">
              <p role="alert" className="text-[12.5px] text-critical">
                {view.ai.reason ?? "AI assist is off. Choose a provider in Settings → AI."}
              </p>
              <p className="text-[12px] text-faint">Nothing is sent until AI is on and Test connection passed.</p>
              <button type="button" onClick={close} className={btn.outline}>
                Close
              </button>
            </div>
          )}

          {phase === "ready" && view && view.ai.ready && count === 0 && (
            <div className="space-y-2">
              <p className="text-[12.5px] text-muted">Nothing to plan today.</p>
              <button type="button" onClick={close} className={btn.outline}>
                Close
              </button>
            </div>
          )}

          {phase === "ready" && view && view.ai.ready && count > 0 && (
            <div className="space-y-2">
              <p className="text-[12.5px] text-muted">
                One plan for today. Sends: {SENDS} Nothing changes until you accept an item.
              </p>
              {jobError ? (
                <div className="space-y-2">
                  <p role="alert" className="text-[12.5px] text-critical">
                    Could not plan the day: {jobError}
                  </p>
                  <button type="button" onClick={() => void start()} className={btn.outline} data-ai-plan-retry>
                    <Icon name="refresh" size={13} />
                    Retry
                  </button>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-1.5">
                  <button type="button" onClick={() => void start()} className={btn.primary} data-ai-plan-start>
                    <Icon name="zap" size={13} />
                    Plan my day
                  </button>
                  <button type="button" onClick={close} className={btn.ghost}>
                    Cancel
                  </button>
                </div>
              )}
              {message && (
                <p role="status" className="text-[12px] text-faint">
                  {message}
                </p>
              )}
            </div>
          )}

          {phase === "running" && (
            <div className="space-y-2">
              <p role="status" className="flex items-center gap-2 text-[12.5px] text-muted" data-ai-plan-progress>
                <span className="size-3 animate-spin rounded-full border-2 border-line border-t-brand" aria-label="Asking the model" />
                Asking the model for today&apos;s plan…
                <Elapsed since={job?.createdAt ?? null} />
              </p>
              <button type="button" onClick={() => void cancel()} className={btn.outline} data-ai-plan-cancel>
                <Icon name="x" size={13} />
                Cancel
              </button>
            </div>
          )}

          {plan && (phase === "ready" || phase === "done") && (
            <div className="space-y-2">
              {!plan.fresh && (
                <p className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[11.5px] font-medium text-warning" data-ai-plan-outdated>
                    Outdated · Run again
                  </span>
                  <button type="button" onClick={() => void start()} className={btn.ghost} data-ai-plan-rerun>
                    <Icon name="refresh" size={13} />
                    Run again
                  </button>
                </p>
              )}
              <p className="text-[13.5px] leading-snug" data-ai-plan-summary>
                {plan.result.summary}
              </p>
              {rows.length > 0 ? (
                <ul aria-label="Today's plan" data-ai-plan-list className="max-h-[46vh] space-y-2 overflow-y-auto pr-0.5">
                  {rows.map((row) => (
                    <li key={row.key} data-ai-plan-item={row.id} className="rounded-lg border border-line px-2.5 py-2">
                      <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13px] font-medium" title={row.title}>
                            {row.kind === "issue" ? <span className="text-faint">#{row.number} </span> : null}
                            {row.title}
                          </p>
                          <p className="mt-0.5 text-[12px] text-muted">{row.reason}</p>
                        </div>
                        <button type="button" onClick={() => dismissRow(row)} className={btn.ghost} data-ai-plan-dismiss>
                          <Icon name="x" size={13} />
                          Dismiss
                        </button>
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        {row.kind === "task" && row.next && (
                          <>
                            <span className="inline-flex h-6 items-center gap-1 rounded-full border border-line bg-surface px-2 text-[12px] text-muted">
                              <Icon name="calendar" size={12} className="text-faint" />
                              {dueLabel(row.next.dueDate, today).text}
                              {row.next.dueTime ? ` ${row.next.dueTime}` : ""}
                            </span>
                            <button type="button" onClick={() => void accept(row)} className={btn.outline} data-ai-plan-accept>
                              <Icon name="check" size={13} />
                              Accept
                            </button>
                          </>
                        )}
                        {row.kind === "issue" && (
                          <button
                            type="button"
                            onClick={() => void addTask(row)}
                            className={btn.outline}
                            disabled={row.linked}
                            title={row.linked ? "A task already links this issue" : "Create a local task linked to this issue"}
                            data-ai-plan-add-task
                          >
                            <Icon name="plus" size={13} />
                            {row.linked ? "Already in tasks" : "Add to tasks"}
                          </button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[12.5px] text-muted">Nothing left to show from this plan.</p>
              )}
              <div className="flex flex-wrap items-center gap-1.5 border-t border-line pt-2">
                {plan.id && (
                  <button type="button" onClick={dismissPlan} className={btn.ghost} data-ai-plan-dismiss-plan>
                    <Icon name="x" size={13} />
                    Dismiss plan
                  </button>
                )}
                <button type="button" onClick={close} className={btn.ghost}>
                  Close
                </button>
              </div>
            </div>
          )}
        </div>
      </Dialog>
    </>
  );
}
