"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { localTime, localToday } from "@/lib/tasks/dates";
import { parseQuickAdd, type TokenKind } from "@/lib/tasks/quick-add";
import type { Prefs, TaskProject } from "@/lib/tasks/model";
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
 */
export function QuickAddWindow() {
  const [text, setText] = useState("");
  const [ignored, setIgnored] = useState<Set<string>>(new Set());
  const [projects, setProjects] = useState<TaskProject[]>([]);
  const [tz, setTz] = useState(browserTz);
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);
  const saving = useRef(false);

  useEffect(() => {
    void (async () => {
      const [t, p] = await Promise.all([
        fetch("/api/tasks", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null), () => null),
        fetch("/api/me/prefs", { cache: "no-store" }).then((r) => (r.ok ? (r.json() as Promise<Prefs>) : null), () => null),
      ]);
      if (t) {
        setProjects((t.projects as TaskProject[]).filter((x) => !x.archived));
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

  const submit = async () => {
    if (!parsed.title || saving.current) return;
    saving.current = true;
    setState("saving");
    setError(null);
    const projectId = parsed.project ? (projects.find((p) => p.name === parsed.project)?.id ?? null) : null;
    const dueDate = parsed.dueDate;
    const res = await fetch("/api/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: parsed.title,
        priority: parsed.priority ?? 4,
        dueDate,
        dueTime: dueDate ? parsed.dueTime : null,
        tz,
        recurrence: dueDate && parsed.recurrence ? { rule: parsed.recurrence.rule, text: parsed.recurrence.label, fromCompletion: parsed.recurrence.fromCompletion } : null,
        projectId,
        labels: parsed.labels,
      }),
    }).catch(() => null);
    saving.current = false;
    if (res?.ok) {
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

  return (
    <main className="flex h-screen flex-col justify-center gap-2 bg-surface px-5" data-quick-add data-state={state}>
      <p className="text-[11px] font-medium uppercase tracking-wide text-faint">New task</p>
      <QuickAddInput
        autoFocus
        label="Task"
        value={text}
        onChange={setText}
        tokens={parsed.tokens}
        onRevert={(key) => setIgnored((prev) => new Set(prev).add(key))}
        onSubmit={() => void submit()}
        placeholder="e.g. Call dentist tomorrow 3pm high"
      />
      <p className="min-h-4 text-[11.5px] text-faint" role={error ? "alert" : undefined}>
        {error ? <span className="text-critical">{error}</span> : <>↵ to save · Esc to close · <b className="font-medium">fri</b> · <b className="font-medium">high</b> · <b className="font-medium">+label</b> · <b className="font-medium">=Project</b></>}
      </p>
    </main>
  );
}
