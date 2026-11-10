"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { normalizeTaskSuggestion } from "@/lib/ai/task-assist";
import { localTime, localToday } from "@/lib/tasks/dates";
import type { Priority, Prefs, TaskLabel, TaskProject, TaskSection } from "@/lib/tasks/model";
import { parseQuickAdd, type TokenKind } from "@/lib/tasks/quick-add";
import { Icon } from "../icons";
import { btn } from "../ui/popover";
import { TaskAssistChips, useTaskAssist, type TaskAssistChoices } from "./ai-task-assist";
import { QuickAddInput } from "./quick-add-input";

/** What the one-line window can store: no `#issue` links (it has no issue data). */
const ENABLED: ReadonlySet<TokenKind> = new Set<TokenKind>(["date", "time", "recurrence", "priority", "project", "label"]);

function browserTz(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

const close = () => void window.deska?.quickAdd?.close();

/**
 * The floating quick-add window (SPEC §4.6). Enter saves and closes, Esc
 * closes. It uses the same parser as the in-app quick add, so
 * "call dentist tomorrow 3pm high =Home +phone" means the same here.
 * The ✨ action asks the model for the same properties as chips to check before
 * saving; the plain parse is what Enter saves without it (SPEC §4.9).
 */
export function QuickAddWindow() {
  const [text, setText] = useState("");
  const [ignored, setIgnored] = useState<Set<string>>(new Set());
  const [projects, setProjects] = useState<TaskProject[]>([]);
  const [labels, setLabels] = useState<TaskLabel[]>([]);
  const [sections, setSections] = useState<TaskSection[]>([]);
  const [tz, setTz] = useState(browserTz);
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);
  const saving = useRef(false);
  const assist = useTaskAssist();

  useEffect(() => {
    void (async () => {
      const [t, p] = await Promise.all([
        fetch("/api/tasks", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null), () => null),
        fetch("/api/me/prefs", { cache: "no-store" }).then((r) => (r.ok ? (r.json() as Promise<Prefs>) : null), () => null),
      ]);
      if (t) {
        setProjects((t.projects as TaskProject[]).filter((x) => !x.archived));
        setLabels((t.labels as TaskLabel[] | undefined) ?? []);
        setSections((t.sections as TaskSection[] | undefined) ?? []);
      }
      if (p?.tz) setTz(p.tz);
    })();
  }, []);

  // Esc closes, wherever the focus is.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const names = useMemo(() => projects.map((p) => p.name), [projects]);
  const now = new Date();
  const parsed = useMemo(
    () => parseQuickAdd(text, { today: localToday(now, tz), now: localTime(now, tz), ignored, projects: names, enabled: ENABLED }),
    // The clock is read at parse time; a new keystroke is the reason to re-parse.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [text, tz, ignored, names],
  );

  // The suggestion is fixed up against the lists this window loaded (SPEC §4.9):
  // a project, section or label that is not there cannot become the task's.
  const ai = useMemo(() => {
    const s = assist.suggestion;
    if (!s) return null;
    return normalizeTaskSuggestion(
      {
        projects: projects.map((p) => ({ id: p.id, name: p.name, sections: sections.filter((x) => x.projectId === p.id).map((x) => ({ id: x.id, name: x.name })) })),
        labels: labels.map((l) => ({ id: l.id, name: l.name })),
        current: null,
      },
      s,
    );
  }, [assist.suggestion, projects, sections, labels]);
  const aiChoices = useMemo<TaskAssistChoices>(() => ({ projects, sections, labels, today: localToday(new Date(), tz) }), [projects, sections, labels, tz]);

  // Typing changes the line the suggestion was for: drop it (SPEC §4.9).
  const changeText = (v: string) => {
    if (assist.suggestion || assist.phase !== "idle" || assist.error) assist.reset();
    setText(v);
  };

  const askAi = () => {
    const at = new Date();
    void assist.run(text, { today: localToday(at, tz), now: localTime(at, tz), tz });
  };

  const submit = async () => {
    const title = ai?.title ?? parsed.title;
    if (!title || saving.current) return;
    saving.current = true;
    setState("saving");
    setError(null);
    const projectId = ai?.projectId ?? (parsed.project ? (projects.find((p) => p.name === parsed.project)?.id ?? null) : null);
    const dueDate = ai?.dueDate ?? parsed.dueDate;
    const dueTime = dueDate ? (ai?.dueDate ? (ai.dueTime ?? null) : parsed.dueTime) : null;
    const recurrence = dueDate ? (ai?.dueDate ? (ai.recurrence ?? null) : (parsed.recurrence ? { rule: parsed.recurrence.rule, text: parsed.recurrence.label, fromCompletion: parsed.recurrence.fromCompletion } : null)) : null;
    const priority = (ai?.priority as Priority | undefined) ?? parsed.priority ?? 4;
    const aiLabels = (ai?.labelIds ?? []).flatMap((id) => labels.find((l) => l.id === id)?.name ?? []);
    const aiIssue = ai?.issueNumber != null ? Number(ai.issueNumber) : null;
    const resultId = assist.resultId;
    const res = await fetch("/api/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title,
        priority,
        dueDate,
        dueTime,
        tz,
        recurrence,
        projectId,
        // Only the suggestion can name a section here; without one the body is
        // exactly what the plain parse always sent.
        ...(ai?.projectId ? { sectionId: ai.sectionId ?? null } : {}),
        labels: [...new Set([...parsed.labels, ...aiLabels])],
        ...(aiIssue != null ? { links: [aiIssue] } : {}),
      }),
    }).catch(() => null);
    saving.current = false;
    if (res?.ok) {
      // The suggestion became the task: record it accepted (SPEC §4.9).
      assist.reset();
      if (resultId) void fetch(`/api/ai/results/${resultId}/outcome`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ outcome: "accepted" }) }).catch(() => null);
      setState("saved");
      close();
      return;
    }
    setState("idle");
    setError(
      !res
        ? "Could not reach Deska."
        : res.status === 401
          ? "Connect GitHub in Deska first."
          : (await res.json().catch(() => null))?.error ?? `Could not save (HTTP ${res.status}).`,
    );
  };

  const aiBusy = assist.phase === "checking" || assist.phase === "running";
  return (
    <main className="flex h-screen flex-col justify-center gap-2 bg-surface px-5" data-quick-add data-state={state}>
      <div className="flex items-center gap-2">
        <p className="flex-1 text-[11px] font-medium uppercase tracking-wide text-faint">New task</p>
        <button
          type="button"
          onClick={askAi}
          className={btn.ghost}
          disabled={!text.trim() || aiBusy}
          aria-label="AI assist"
          title="Ask the model to fill in the task's properties"
          data-ai-assist
        >
          <Icon name="zap" size={13} />
          AI assist
        </button>
      </div>
      <QuickAddInput
        autoFocus
        label="Task"
        value={text}
        onChange={changeText}
        tokens={parsed.tokens}
        onRevert={(key) => setIgnored((prev) => new Set(prev).add(key))}
        onSubmit={() => void submit()}
        placeholder="e.g. Call dentist tomorrow 3pm high"
      />
      {aiBusy && (
        <p role="status" className="flex items-center gap-2 text-[11.5px] text-muted" data-ai-assist-progress>
          <span className="size-3 animate-spin rounded-full border-2 border-line border-t-brand" aria-label="Asking the model" />
          {assist.phase === "checking" ? "Checking AI assist…" : "Asking the model…"}
          <button type="button" onClick={() => void assist.cancel()} className={btn.ghost}>
            Cancel
          </button>
        </p>
      )}
      {ai && <TaskAssistChips suggestion={ai} choices={aiChoices} onRemove={assist.removeField} onDismiss={assist.dismiss} />}
      {assist.error && (
        <p role="alert" className="text-[11.5px] text-critical" data-ai-assist-error>
          {assist.error.kind === "failed" ? `AI unavailable — ${assist.error.message}` : assist.error.message}
        </p>
      )}
      <p className="min-h-4 text-[11.5px] text-faint" role={error ? "alert" : undefined}>
        {error ? <span className="text-critical">{error}</span> : <>↵ to save · Esc to close · <b className="font-medium">fri</b> · <b className="font-medium">high</b> · <b className="font-medium">+label</b> · <b className="font-medium">=Project</b></>}
      </p>
    </main>
  );
}
