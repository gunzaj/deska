"use client";

// "Tidy Inbox" (SPEC §4.9, AI2): asks for one suggestion per Inbox task,
// shows each as chips with its reason, and Accept applies a normal local edit with
// Undo. AI runs only when the user asks: opening the dialog reads the stored
// suggestions and the status, and nothing is sent until "Suggest for N tasks" is
// clicked. Accepting a task change is a normal local edit, never a GitHub write.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Job } from "@/lib/ai/runner";
import { normalizeTaskSuggestion, tidyPatch, type TaskAssistSuggestion } from "@/lib/ai/task-assist";
import { undoPatchOf } from "@/lib/tasks/undo";
import type { TaskSuggestionView, TidyInboxView } from "@/lib/ai/task-assist-service";
import { usePoll } from "@/lib/client/poll";
import type { PatchTaskInput, Task } from "@/lib/tasks/model";
import { Elapsed } from "../ai/elapsed";
import { useAppData } from "../app/provider";
import { Icon } from "../icons";
import { Dialog } from "../ui/dialog";
import { btn } from "../ui/popover";
import { useToast } from "../ui/toast";
import { aiCall, TaskAssistChips, type TaskAssistChoices } from "./ai-task-assist";
import { useToday } from "./notifications";
import { openTask } from "./open-task";
import { useTasks } from "./store";

/** Above this many Inbox tasks the batch asks once more before sending (SPEC §4.9). */
export const TIDY_CONFIRM_ABOVE = 20;

type Phase = "closed" | "loading" | "ready" | "running" | "finished";

/** What a suggestion is checked against: the same choices the server builds its schema from. */
type Choices = {
  projects: { id: string; name: string; sections: { id: string; name: string }[] }[];
  labels: { id: string; name: string }[];
};

/** One row of the dialog: an Inbox task, the job asking for it (if any), and its suggestion. */
type Proposal = {
  taskId: string;
  title: string;
  task: Task | null;
  suggestion: TaskSuggestionView | null;
  job: Job | null;
};

const ended = (j: Job) => j.state === "done" || j.state === "error" || j.state === "cancelled";

/** The task's current values, as the suggestion's input sees them. */
function currentOf(task: Task) {
  return {
    title: task.title,
    projectId: task.projectId,
    sectionId: task.sectionId,
    labelIds: task.labels,
    priority: task.priority,
    dueDate: task.dueDate,
    dueTime: task.dueTime,
    recurrence: task.recurrence,
    links: task.links.map((l) => l.number),
  };
}

/**
 * The "Tidy Inbox" button and dialog. The button sits in the Inbox page's
 * actions; the dialog reads the Inbox and its stored suggestions on open, runs the
 * batch on request, and shows each suggestion as chips to Accept, Edit or Dismiss.
 */
export function TidyInbox() {
  const { tasks, projects, labels, sections, update } = useTasks();
  const { byNumber } = useAppData();
  const { today, now, tz } = useToday();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("closed");
  const [view, setView] = useState<TidyInboxView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [batchId, setBatchId] = useState<string | null>(null);
  // Every job of the batch, by task id (`job.subject`): a job pruned from the
  // runner's map stays counted from what the page already saw (SPEC §4.9).
  const [jobs, setJobs] = useState<Map<string, Job>>(new Map());
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<string | null>(null);
  // A GET answer that arrives after the dialog closed must not fill it again.
  const seq = useRef(0);

  const activeProjects = useMemo(() => projects.filter((p) => !p.archived), [projects]);
  const choices = useMemo<Choices>(
    () => ({
      projects: activeProjects.map((p) => ({ id: p.id, name: p.name, sections: sections.filter((s) => s.projectId === p.id).map((s) => ({ id: s.id, name: s.name })) })),
      labels: labels.map((l) => ({ id: l.id, name: l.name })),
    }),
    [activeProjects, sections, labels],
  );
  const chipsChoices = useMemo<TaskAssistChoices>(
    () => ({ projects: activeProjects, sections, labels, today, issueTitle: (n) => byNumber.get(n)?.title }),
    [activeProjects, sections, labels, today, byNumber],
  );

  const markOutcome = useCallback((id: string | null, outcome: "accepted" | "dismissed") => {
    // The local edit is applied here; recording the outcome is bookkeeping (SPEC §4.9).
    if (id) void aiCall(`/api/ai/results/${id}/outcome`, "POST", { outcome }).catch(() => null);
  }, []);

  const patchOf = useCallback(
    (task: Task, suggestion: TaskAssistSuggestion) => tidyPatch({ projects: choices.projects, labels: choices.labels, current: currentOf(task) }, suggestion),
    [choices],
  );

  const load = useCallback(async () => {
    const my = ++seq.current;
    setOpen(true);
    setPhase("loading");
    setView(null);
    setLoadError(null);
    setMessage(null);
    setJobs(new Map());
    setBatchId(null);
    setRemoved(new Set());
    try {
      const body = (await aiCall("/api/ai/tidy-inbox", "GET")) as unknown as TidyInboxView;
      if (my !== seq.current) return;
      setView(body);
      setPhase("ready");
    } catch (e) {
      if (my !== seq.current) return;
      setLoadError(e instanceof Error ? e.message : String(e));
      setPhase("ready");
    }
  }, []);

  const close = useCallback(() => {
    seq.current++;
    // Closing during a batch would leave model calls running with nobody to show them.
    for (const job of jobs.values()) {
      if (job.state === "queued" || job.state === "running") void aiCall(`/api/ai/jobs/${job.id}/cancel`, "POST").catch(() => null);
    }
    setOpen(false);
    setPhase("closed");
    setView(null);
    setLoadError(null);
    setMessage(null);
    setJobs(new Map());
    setBatchId(null);
    setRemoved(new Set());
  }, [jobs]);

  const proposals = useMemo<Proposal[]>(() => {
    if (!view) return [];
    return view.tasks
      .filter((t) => !removed.has(t.taskId))
      .map((t) => {
        const task = tasks.find((x) => x.id === t.taskId) ?? null;
        const job = jobs.get(t.taskId) ?? null;
        if (job && job.state === "done" && job.result != null) {
          const result = normalizeTaskSuggestion({ projects: choices.projects, labels: choices.labels, current: null }, job.result as TaskAssistSuggestion);
          return {
            taskId: t.taskId,
            title: t.title,
            task,
            suggestion: { id: job.resultId, result, provider: job.provider ?? "", model: job.model ?? "", createdAt: job.finishedAt ?? job.createdAt, acceptedAt: null, dismissedAt: null, fresh: true },
            job: null,
          };
        }
        if (job && (job.state === "queued" || job.state === "running" || job.state === "error")) return { taskId: t.taskId, title: t.title, task, suggestion: null, job };
        return {
          taskId: t.taskId,
          title: t.title,
          task,
          suggestion: t.suggestion ? { ...t.suggestion, result: normalizeTaskSuggestion({ projects: choices.projects, labels: choices.labels, current: null }, t.suggestion.result) } : null,
          job: null,
        };
      });
  }, [view, jobs, removed, tasks, choices]);

  const withSuggestion = proposals.filter((p) => p.suggestion);
  const count = view ? Math.min(view.total, view.tasks.length) : 0;

  const start = useCallback(async () => {
    setMessage(null);
    setPhase("running");
    try {
      const body = (await aiCall("/api/ai/tidy-inbox", "POST", { today, now, tz })) as unknown as { batchId: string; jobs: Job[]; total: number };
      setJobs(new Map(body.jobs.map((j) => [j.subject, j])));
      setBatchId(body.batchId);
      if (body.jobs.length === 0) {
        setMessage("There are no Inbox tasks to tidy.");
        setPhase("finished");
      } else if (body.jobs.every(ended)) {
        setPhase("finished");
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
      setPhase("finished");
    }
  }, [today, now, tz]);

  const batch = useRef<string | null>(null);
  batch.current = batchId;
  const poll = useCallback(async () => {
    const id = batch.current;
    if (!id) return;
    try {
      const body = (await aiCall(`/api/ai/jobs?batch=${encodeURIComponent(id)}`, "GET")) as unknown as { jobs: Job[] };
      setJobs((prev) => {
        const next = new Map(prev);
        for (const job of body.jobs) next.set(job.subject, job);
        return next;
      });
    } catch {
      /* a transient poll failure: try again next tick */
    }
  }, []);
  usePoll(poll, { every: 1000, enabled: phase === "running" });

  const batchList = useMemo(() => [...jobs.values()], [jobs]);
  // Every job has ended: the batch says how it went and stops polling.
  useEffect(() => {
    if (phase === "running" && batchList.length > 0 && batchList.every(ended)) setPhase("finished");
  }, [phase, batchList]);

  const cancel = useCallback(async () => {
    const active = batchList.filter((j) => j.state === "queued" || j.state === "running");
    await Promise.all(active.map((j) => aiCall(`/api/ai/jobs/${j.id}/cancel`, "POST").catch(() => null)));
    const cancelledAt = new Date().toISOString();
    setJobs((prev) => {
      const next = new Map(prev);
      for (const [taskId, job] of next) if (job.state === "queued" || job.state === "running") next.set(taskId, { ...job, state: "cancelled", finishedAt: cancelledAt });
      return next;
    });
    setMessage(`Cancelled after ${batchList.filter((j) => j.state === "done").length} of ${batchList.length}.`);
    setPhase("finished");
  }, [batchList]);

  const rerun = useCallback(
    async (taskId: string) => {
      if (phase === "running") return;
      setMessage(null);
      setPhase("running");
      try {
        const body = (await aiCall("/api/ai/tidy-inbox", "POST", { taskIds: [taskId], today, now, tz })) as unknown as { batchId: string; jobs: Job[]; total: number };
        setJobs(new Map(body.jobs.map((j) => [j.subject, j])));
        setBatchId(body.batchId);
        if (body.jobs.length === 0 || body.jobs.every(ended)) setPhase("finished");
      } catch (e) {
        setMessage(e instanceof Error ? e.message : String(e));
        setPhase("finished");
      }
    },
    [phase, today, now, tz],
  );

  /** Apply one suggestion as a local edit; Undo puts back the fields the patch touched. */
  const accept = useCallback(
    async (proposal: Proposal) => {
      const task = proposal.task;
      const suggestion = proposal.suggestion;
      if (!task || !suggestion) return;
      const patch = patchOf(task, suggestion.result);
      if (!patch) {
        markOutcome(suggestion.id, "accepted");
        setRemoved((prev) => new Set(prev).add(task.id));
        toast({ message: `“${task.title}” is already tidy.` });
        return;
      }
      const res = await update(task.id, patch);
      if (!res) return; // the store's error banner says why
      setRemoved((prev) => new Set(prev).add(task.id));
      markOutcome(suggestion.id, "accepted");
      toast({ message: `Tidied “${task.title}”`, action: { label: "Undo", run: () => void update(task.id, undoPatchOf(task, patch, labels)) } });
    },
    [markOutcome, patchOf, update, labels, toast],
  );

  /** Apply every suggestion with one Undo toast (SPEC §4.9: accept per task or all). */
  const acceptAll = useCallback(async () => {
    const ready = proposals.filter((p) => p.suggestion && p.task);
    const applied: { task: Task; patch: PatchTaskInput }[] = [];
    for (const proposal of ready) {
      const task = proposal.task as Task;
      const suggestion = proposal.suggestion as TaskSuggestionView;
      const patch = patchOf(task, suggestion.result);
      if (!patch) {
        markOutcome(suggestion.id, "accepted");
        setRemoved((prev) => new Set(prev).add(task.id));
        continue;
      }
      const res = await update(task.id, patch);
      if (!res) continue;
      markOutcome(suggestion.id, "accepted");
      applied.push({ task, patch });
    }
    if (applied.length === 0) return;
    setRemoved((prev) => new Set([...prev, ...applied.map((a) => a.task.id)]));
    toast({
      message: `Tidied ${applied.length} task${applied.length === 1 ? "" : "s"}`,
      action: {
        label: "Undo",
        run: async () => {
          for (const { task, patch } of applied) await update(task.id, undoPatchOf(task, patch, labels));
        },
      },
    });
  }, [proposals, patchOf, markOutcome, update, labels, toast]);

  const dismiss = useCallback(
    (proposal: Proposal) => {
      setRemoved((prev) => new Set(prev).add(proposal.taskId));
      if (proposal.suggestion) markOutcome(proposal.suggestion.id, "dismissed");
    },
    [markOutcome],
  );

  /** Edit opens the task itself; the suggestion is dismissed (the user will save it by hand). */
  const edit = useCallback(
    (proposal: Proposal) => {
      dismiss(proposal);
      close();
      openTask(proposal.taskId);
    },
    [dismiss, close],
  );

  return (
    <>
      <button type="button" onClick={() => void load()} className={btn.ghost} data-ai-tidy-open>
        <Icon name="zap" size={13} />
        Tidy Inbox
      </button>
      <Dialog open={open} onClose={close} label="Tidy Inbox" width={560}>
        <div className="space-y-3 p-4" data-ai-tidy-dialog>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[14px] font-semibold">Tidy Inbox</p>
              {view && (
                <p className="text-[12px] text-faint" data-ai-tidy-count>
                  {view.total > view.tasks.length ? `the first ${view.tasks.length} of ${view.total} Inbox tasks` : `${view.total} Inbox task${view.total === 1 ? "" : "s"}`}
                </p>
              )}
            </div>
            <button type="button" onClick={close} aria-label="Close" className={btn.icon}>
              <Icon name="x" size={15} />
            </button>
          </div>

          {phase === "loading" && (
            <p role="status" className="text-[12.5px] text-muted">
              Checking the Inbox…
            </p>
          )}

          {phase === "ready" && loadError && (
            <div className="space-y-2">
              <p role="alert" className="text-[12.5px] text-critical">
                Could not load the Inbox: {loadError}
              </p>
              <button type="button" onClick={() => void load()} className={btn.outline} data-ai-tidy-retry>
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

          {phase === "ready" && view && view.ai.ready && view.total === 0 && (
            <div className="space-y-2">
              <p className="text-[12.5px] text-muted">Your Inbox is empty: nothing to tidy.</p>
              <button type="button" onClick={close} className={btn.outline}>
                Close
              </button>
            </div>
          )}

          {phase === "ready" && view && view.ai.ready && view.total > 0 && (
            <div className="space-y-2">
              <p className="text-[12.5px] text-muted">
                One suggestion per Inbox task, one at a time. Each task&apos;s title and description go to the model you chose; nothing changes until you accept.
              </p>
              {count > TIDY_CONFIRM_ABOVE && (
                <p className="rounded-lg bg-banner-warning px-3 py-2 text-[12.5px] text-warning" data-ai-tidy-big>
                  That is a big batch: {count} Inbox tasks, so it can take a while. Deska asks each one in turn.
                </p>
              )}
              <div className="flex flex-wrap items-center gap-1.5">
                <button type="button" onClick={() => void start()} className={btn.primary} data-ai-tidy-start>
                  <Icon name="zap" size={13} />
                  Suggest for {count} task{count === 1 ? "" : "s"}
                </button>
                <button type="button" onClick={close} className={btn.ghost}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {phase === "running" && (
            <div className="space-y-2">
              <p role="status" className="text-[12.5px] text-muted" data-ai-tidy-progress>
                {batchList.filter(ended).length} of {batchList.length} done · one at a time
                {batchList[0] ? <> · <Elapsed since={batchList[0].createdAt} /></> : null}
              </p>
              <button type="button" onClick={() => void cancel()} className={btn.outline} data-ai-tidy-cancel>
                <Icon name="x" size={13} />
                Cancel batch
              </button>
            </div>
          )}

          {phase === "finished" && (
            <p role="status" className="text-[12.5px] text-muted" data-ai-tidy-done>
              {message ??
                (batchList.some((j) => j.state === "error")
                  ? `${withSuggestion.length} suggestions ready, ${batchList.filter((j) => j.state === "error").length} failed.`
                  : `${withSuggestion.length} suggestion${withSuggestion.length === 1 ? "" : "s"} ready.`)}
            </p>
          )}

          {(phase === "ready" || phase === "finished") && proposals.length > 0 && (
            <ul aria-label="Tidy proposals" data-ai-tidy-list className="max-h-[46vh] space-y-2 overflow-y-auto pr-0.5">
              {proposals.map((proposal) => (
                <li key={proposal.taskId} data-ai-tidy-task={proposal.taskId} className="rounded-lg border border-line px-2.5 py-2">
                  <div className="flex items-start gap-2">
                    <p className="min-w-0 flex-1 truncate text-[13px] font-medium" title={proposal.task?.title ?? proposal.title}>
                      {proposal.task?.title ?? proposal.title}
                    </p>
                    {proposal.job && (proposal.job.state === "queued" || proposal.job.state === "running") && (
                      <span role="status" className="flex shrink-0 items-center gap-1.5 text-[11.5px] text-muted">
                        <span className="size-3 animate-spin rounded-full border-2 border-line border-t-brand" aria-label="Asking the model" />
                        Asking the model…
                      </span>
                    )}
                    {proposal.suggestion && !proposal.suggestion.fresh && (
                      <span className="shrink-0 text-[11.5px] font-medium text-warning" data-ai-tidy-outdated>
                        Outdated · Run again
                      </span>
                    )}
                  </div>
                  {proposal.suggestion ? (
                    <>
                      <div className="mt-1.5">
                        <TaskAssistChips suggestion={proposal.suggestion.result} choices={chipsChoices} label={`Suggestion for ${proposal.title}`} />
                      </div>
                      <p className="mt-1 text-[12px] text-muted">{proposal.suggestion.result.reason}</p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => void accept(proposal)}
                          className={btn.outline}
                          disabled={!proposal.task}
                          title={proposal.task ? "Apply this suggestion as a local edit" : "This task is no longer in the Inbox"}
                          data-ai-tidy-accept
                        >
                          <Icon name="check" size={13} />
                          Accept
                        </button>
                        <button type="button" onClick={() => edit(proposal)} className={btn.outline} disabled={!proposal.task} data-ai-tidy-edit>
                          <Icon name="sliders" size={13} />
                          Edit
                        </button>
                        <button type="button" onClick={() => dismiss(proposal)} className={btn.ghost} data-ai-tidy-dismiss>
                          <Icon name="x" size={13} />
                          Dismiss
                        </button>
                        {!proposal.suggestion.fresh && (
                          <button type="button" onClick={() => void rerun(proposal.taskId)} className={btn.ghost} data-ai-tidy-rerun>
                            <Icon name="refresh" size={13} />
                            Run again
                          </button>
                        )}
                      </div>
                    </>
                  ) : proposal.job?.state === "error" ? (
                    <p role="alert" className="mt-1 text-[12px] text-critical">
                      Could not suggest: {proposal.job.error?.message ?? "the model call failed."}
                    </p>
                  ) : (
                    <p className="mt-1 text-[11.5px] text-faint">No suggestion yet.</p>
                  )}
                </li>
              ))}
            </ul>
          )}

          {(phase === "ready" || phase === "finished") && withSuggestion.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 border-t border-line pt-2">
              <button type="button" onClick={() => void acceptAll()} className={btn.outline} data-ai-tidy-accept-all>
                <Icon name="check" size={13} />
                Accept all
              </button>
              <button type="button" onClick={close} className={btn.ghost}>
                Close
              </button>
            </div>
          )}

          {phase === "finished" && withSuggestion.length === 0 && (
            <div className="border-t border-line pt-2">
              <button type="button" onClick={close} className={btn.outline}>
                Close
              </button>
            </div>
          )}
        </div>
      </Dialog>
    </>
  );
}
