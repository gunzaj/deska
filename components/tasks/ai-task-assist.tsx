"use client";

// Task assist (SPEC §4.9, AI2): the one client hook that runs a task-assist job
// and the chips that show what the model suggests. Both quick-add windows use it for
// a typed line; "Tidy Inbox" shows the same chips per Inbox task. AI is only an
// explicit action (the ✨ button): nothing is sent until /api/ai/status says AI may
// run, and a suggestion is text until the user saves or accepts it.
import { useCallback, useRef, useState } from "react";
import type { Job } from "@/lib/ai/runner";
import type { TaskAssistSuggestion } from "@/lib/ai/task-assist";
import { dueLabel } from "@/lib/tasks/dates";
import { PRIORITIES, type TaskLabel, type TaskProject, type TaskSection } from "@/lib/tasks/model";
import { usePoll } from "@/lib/client/poll";
import { Icon, type IconName } from "../icons";
import { btn } from "../ui/popover";

/** The page's clock, so "tomorrow" resolves the way the page's parser resolves it. */
export type TaskAssistClock = { today: string; now: string; tz: string };

/**
 * Why no suggestion came back: the user has not set AI up ("not-ready", the
 * /api/ai/status reason), or the provider call failed ("failed"). Both are shown,
 * and Enter still saves the plain parse.
 */
export type TaskAssistProblem = { kind: "not-ready" | "failed"; message: string };

export type TaskAssistPhase = "idle" | "checking" | "running" | "done";

export type TaskAssist = {
  phase: TaskAssistPhase;
  suggestion: TaskAssistSuggestion | null;
  resultId: string | null;
  error: TaskAssistProblem | null;
  /** Ask for a suggestion for one typed line; does nothing when AI may not run. */
  run: (text: string, clock: TaskAssistClock) => Promise<void>;
  /** Stop the running job (its answer is dropped). */
  cancel: () => Promise<void>;
  /** Drop the suggestion without recording an outcome (typing, closing, a new run). */
  reset: () => void;
  /** Drop the suggestion and record it dismissed in `ai_results` (SPEC §4.9). */
  dismiss: () => void;
  /** Drop one field from the suggestion (a chip's ✕). */
  removeField: (field: TaskAssistField, id?: string) => void;
};

/** The same small request helper as the AI1 components: JSON in, JSON out, an error message. */
export async function aiCall(url: string, method: "GET" | "POST", body?: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(url, { method, cache: "no-store", headers: body === undefined ? undefined : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const out = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(typeof out.error === "string" ? out.error : `Request failed (${res.status})`);
  return out;
}

/** The parts of a suggestion the chips can show. */
export type TaskAssistField = "title" | "due" | "recurrence" | "priority" | "project" | "section" | "label" | "issue";

/** What the chips resolve names from: only values in these lists are shown (SPEC §4.9 "Closed choices"). */
export type TaskAssistChoices = {
  projects: TaskProject[];
  sections: TaskSection[];
  labels: TaskLabel[];
  /** Today in the viewer's zone, for the due-date label. */
  today: string;
  /** The cached issue's title, when the page has the issue data. */
  issueTitle?: (number: number) => string | undefined;
};

/** One chip: a suggested field with its name resolved from the caller's lists. */
export type TaskAssistChip = { key: string; field: TaskAssistField; id?: string; label: string; icon: IconName };

/**
 * The suggestion as chips: a title, due date and time, recurrence, priority, the
 * project, section and labels it names, and the linked issue. A value that is not in
 * the caller's lists is left out, so a chip can only name something that exists.
 */
export function taskAssistChips(s: TaskAssistSuggestion, choices: TaskAssistChoices): TaskAssistChip[] {
  const chips: TaskAssistChip[] = [];
  if (s.title) chips.push({ key: "title", field: "title", label: s.title, icon: "list" });
  if (s.dueDate) {
    const due = dueLabel(s.dueDate, choices.today);
    chips.push({ key: "due", field: "due", label: s.dueTime ? `${due.text} ${s.dueTime}` : due.text, icon: "calendar" });
  }
  if (s.recurrence) chips.push({ key: "recurrence", field: "recurrence", label: s.recurrence.text, icon: "repeat" });
  if (s.priority != null) {
    const p = PRIORITIES.find((x) => x.value === s.priority);
    if (p) chips.push({ key: "priority", field: "priority", label: `${p.short} ${p.label}`, icon: "flag" });
  }
  const project = s.projectId ? choices.projects.find((p) => p.id === s.projectId) : undefined;
  if (project) chips.push({ key: "project", field: "project", label: project.name, icon: "list" });
  const section = s.sectionId ? choices.sections.find((x) => x.id === s.sectionId) : undefined;
  if (section) chips.push({ key: "section", field: "section", label: section.name, icon: "layers" });
  for (const id of s.labelIds ?? []) {
    const label = choices.labels.find((l) => l.id === id);
    if (label) chips.push({ key: `label:${id}`, field: "label", id, label: label.name, icon: "tag" });
  }
  if (s.issueNumber != null) {
    const n = Number(s.issueNumber);
    const title = choices.issueTitle?.(n);
    chips.push({ key: "issue", field: "issue", label: title ? `#${n} ${title}` : `#${n}`, icon: "link" });
  }
  return chips;
}

/** The suggestion without one field: a chip's ✕ (a due time and recurrence need the due date). */
export function removeTaskAssistField(s: TaskAssistSuggestion, field: TaskAssistField, id?: string): TaskAssistSuggestion {
  switch (field) {
    case "title":
      return { ...s, title: null };
    case "due":
      return { ...s, dueDate: null, dueTime: null, recurrence: null };
    case "recurrence":
      return { ...s, recurrence: null };
    case "priority":
      return { ...s, priority: null };
    case "project":
      return { ...s, projectId: null, sectionId: null };
    case "section":
      return { ...s, sectionId: null };
    case "label":
      return { ...s, labelIds: (s.labelIds ?? []).filter((x) => x !== id) };
    case "issue":
      return { ...s, issueNumber: null };
  }
}

/** The suggestion as chips; `onRemove` adds a ✕ to each, `onDismiss` drops the whole suggestion. */
export function TaskAssistChips({
  suggestion,
  choices,
  hidden,
  onRemove,
  onDismiss,
  label = "AI suggestion",
}: {
  suggestion: TaskAssistSuggestion;
  choices: TaskAssistChoices;
  /** Fields the user has set by hand: their value wins, so no AI chip for them. */
  hidden?: ReadonlySet<TaskAssistField>;
  onRemove?: (field: TaskAssistField, id?: string) => void;
  onDismiss?: () => void;
  label?: string;
}) {
  const chips = taskAssistChips(suggestion, choices).filter((c) => !hidden?.has(c.field));
  if (!chips.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label={label} data-ai-chips>
      {chips.map((c) => (
        <span key={c.key} data-ai-chip={c.field} className={`inline-flex h-6 max-w-full items-center gap-1 rounded-full border border-line bg-surface pl-2 text-[12px] text-muted ${onRemove ? "pr-0.5" : "pr-2"}`}>
          <Icon name={c.icon} size={12} className="text-faint" />
          <span className="truncate">{c.label}</span>
          {onRemove && (
            <button type="button" onClick={() => onRemove(c.field, c.id)} aria-label={`Remove ${c.label}`} title="Remove" className="grid size-5 shrink-0 place-items-center rounded-full text-faint hover:bg-hover hover:text-fg">
              <Icon name="x" size={11} />
            </button>
          )}
        </span>
      ))}
      {onDismiss && (
        <button type="button" onClick={onDismiss} className={btn.ghost} data-ai-dismiss>
          <Icon name="x" size={12} />
          Dismiss
        </button>
      )}
    </div>
  );
}

/**
 * Runs one task-assist job: checks /api/ai/status first, asks for a suggestion
 * for the typed line, polls the job every 800 ms, and exposes the answer.
 */
export function useTaskAssist(): TaskAssist {
  const [phase, setPhase] = useState<TaskAssistPhase>("idle");
  const [suggestion, setSuggestion] = useState<TaskAssistSuggestion | null>(null);
  const [resultId, setResultId] = useState<string | null>(null);
  const [error, setError] = useState<TaskAssistProblem | null>(null);
  const job = useRef<string | null>(null);
  // A run started before this one (or a reset) must not apply its answer.
  const seq = useRef(0);

  const reset = useCallback(() => {
    seq.current++;
    const id = job.current;
    job.current = null;
    setPhase("idle");
    setSuggestion(null);
    setResultId(null);
    setError(null);
    // Typing while the model asks for the old line: the answer is stale.
    if (id) void aiCall(`/api/ai/jobs/${id}/cancel`, "POST").catch(() => null);
  }, []);

  const run = useCallback(async (text: string, clock: TaskAssistClock) => {
    const typed = text.trim();
    if (!typed) return;
    const my = ++seq.current;
    job.current = null;
    setPhase("checking");
    setSuggestion(null);
    setResultId(null);
    setError(null);
    try {
      // Nothing is sent to a model before the status says AI may run (SPEC §4.9).
      const status = (await aiCall("/api/ai/status", "GET")) as unknown as { ready: boolean; reason: string | null };
      if (my !== seq.current) return;
      if (!status.ready) {
        setError({ kind: "not-ready", message: status.reason ?? "AI assist is off. Choose a provider in Settings → AI." });
        setPhase("idle");
        return;
      }
      const body = (await aiCall("/api/ai/task-assist", "POST", { text: typed, today: clock.today, now: clock.now, tz: clock.tz })) as unknown as { job: Job };
      if (my !== seq.current) {
        // Cancelled or retyped while the job was being queued: stop it unseen.
        void aiCall(`/api/ai/jobs/${body.job.id}/cancel`, "POST").catch(() => null);
        return;
      }
      if (body.job.state === "done" && body.job.result != null) {
        // A job that ended before the first poll is shown at once.
        setSuggestion(body.job.result as TaskAssistSuggestion);
        setResultId(body.job.resultId);
        setPhase("done");
        return;
      }
      if (body.job.state === "error" || body.job.state === "cancelled") {
        if (body.job.state === "error") setError({ kind: "failed", message: body.job.error?.message ?? "The suggestion failed." });
        setPhase("idle");
        return;
      }
      job.current = body.job.id;
      setPhase("running");
    } catch (e) {
      if (my !== seq.current) return;
      setError({ kind: "failed", message: e instanceof Error ? e.message : String(e) });
      setPhase("idle");
    }
  }, []);

  const poll = useCallback(async () => {
    const id = job.current;
    if (!id) return;
    try {
      const body = (await aiCall(`/api/ai/jobs/${id}`, "GET")) as unknown as { job: Job };
      if (job.current !== id) return;
      if (body.job.state === "done" && body.job.result != null) {
        job.current = null;
        setSuggestion(body.job.result as TaskAssistSuggestion);
        setResultId(body.job.resultId);
        setPhase("done");
      } else if (body.job.state === "error" || body.job.state === "cancelled") {
        job.current = null;
        if (body.job.state === "error") setError({ kind: "failed", message: body.job.error?.message ?? "The suggestion failed." });
        setPhase("idle");
      }
    } catch {
      /* a transient poll failure: try again next tick */
    }
  }, []);
  usePoll(poll, { every: 800, enabled: phase === "running" });

  const cancel = useCallback(async () => {
    const id = job.current;
    job.current = null;
    seq.current++;
    setPhase("idle");
    if (id) await aiCall(`/api/ai/jobs/${id}/cancel`, "POST").catch(() => null);
  }, []);

  const dismiss = useCallback(() => {
    const id = resultId;
    reset();
    // Record it dismissed in `ai_results` (SPEC §4.9); the suggestion is gone either way.
    if (id) void aiCall(`/api/ai/results/${id}/outcome`, "POST", { outcome: "dismissed" }).catch(() => null);
  }, [resultId, reset]);

  const removeField = useCallback((field: TaskAssistField, id?: string) => {
    setSuggestion((s) => (s ? removeTaskAssistField(s, field, id) : s));
  }, []);

  return { phase, suggestion, resultId, error, run, cancel, reset, dismiss, removeField };
}
