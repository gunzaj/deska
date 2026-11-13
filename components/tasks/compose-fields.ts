"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TaskAssistSuggestion } from "@/lib/ai/task-assist";
import type { Priority, Recurrence, TaskLabel, TaskProject } from "@/lib/tasks/model";
import type { Parsed } from "@/lib/tasks/quick-add";
import type { TaskAssistField } from "./ai-task-assist";

/** Undefined means "not set by hand": the parsed value, the AI suggestion (or default) applies. */
export type Overrides = { title?: string | null; dueDate?: string | null; dueTime?: string | null; recurrence?: Recurrence | null; priority?: Priority; projectId?: string | null; sectionId?: string | null; labels?: string[] };

export type ComposeFieldsPrefill = { dueDate?: string | null; projectId?: string | null; sectionId?: string | null };

/**
 * What a quick add will save, field by field: a hand pick (the pickers under the
 * line) wins, then the AI suggestion for the fields it names, then the parse of
 * the typed line. Shared by the in-app quick add and the floating window, so a
 * pick means the same in both.
 *
 * `raw` is the suggestion as the model sent it (the key for "a new suggestion
 * arrived"), `ai` the same fixed up against the lists the caller has.
 */
export function useComposeFields({
  parsed,
  raw,
  ai,
  projects,
  labels,
  prefill = {},
}: {
  parsed: Parsed;
  raw: TaskAssistSuggestion | null;
  ai: TaskAssistSuggestion | null;
  projects: TaskProject[];
  labels: TaskLabel[];
  prefill?: ComposeFieldsPrefill;
}) {
  const [over, setOver] = useState<Overrides>({});
  const reset = useCallback(() => setOver({}), []);

  // A new suggestion replaces what was picked by hand for the fields it names
  // (SPEC §4.9: it is chips to check before saving); a field it leaves out keeps
  // the hand pick. Keyed on the suggestion, so a list reload does not re-apply it.
  const applied = useRef<TaskAssistSuggestion | null>(null);
  useEffect(() => {
    if (!raw) {
      applied.current = null;
      return;
    }
    if (applied.current === raw) return;
    applied.current = raw;
    if (!ai) return;
    setOver((o) => {
      const next = { ...o };
      if (ai.title) delete next.title;
      if (ai.dueDate) {
        delete next.dueDate;
        delete next.dueTime;
        delete next.recurrence;
      }
      if (ai.recurrence) delete next.recurrence;
      if (ai.priority != null) delete next.priority;
      if (ai.projectId) {
        delete next.projectId;
        delete next.sectionId;
      }
      if ((ai.labelIds ?? []).length) delete next.labels;
      return next;
    });
  }, [raw, ai]);

  // A hand pick wins over the AI value, so its chip goes away (the picker shows it).
  const aiHidden = useMemo(() => {
    const hidden = new Set<TaskAssistField>();
    if (over.dueDate !== undefined || over.dueTime !== undefined) hidden.add("due");
    if (over.recurrence !== undefined) hidden.add("recurrence");
    if (over.priority !== undefined) hidden.add("priority");
    if (over.projectId !== undefined) hidden.add("project");
    if (over.sectionId !== undefined) hidden.add("section");
    if (over.labels !== undefined) hidden.add("label");
    return hidden;
  }, [over]);

  const dueSource: "manual" | "ai" | "parsed" = over.dueDate !== undefined ? "manual" : ai?.dueDate ? "ai" : "parsed";
  const dueDate = dueSource === "manual" ? (over.dueDate ?? null) : dueSource === "ai" ? (ai?.dueDate ?? null) : (parsed.dueDate ?? prefill.dueDate ?? null);
  const dueTime = dueDate ? (over.dueTime !== undefined ? over.dueTime : dueSource === "ai" ? (ai?.dueTime ?? null) : parsed.dueTime) : null;
  const parsedRecurrence = parsed.recurrence ? { rule: parsed.recurrence.rule, text: parsed.recurrence.label, fromCompletion: parsed.recurrence.fromCompletion } : null;
  const recurrence: Recurrence | null = dueDate ? (over.recurrence !== undefined ? over.recurrence : dueSource === "ai" ? (ai?.recurrence ?? null) : parsedRecurrence) : null;
  const parsedProject = parsed.project ? (projects.find((p) => p.name === parsed.project)?.id ?? null) : null;
  const projectSource: "manual" | "ai" | "parsed" = over.projectId !== undefined ? "manual" : ai?.projectId ? "ai" : "parsed";
  const projectId = projectSource === "manual" ? (over.projectId ?? null) : projectSource === "ai" ? (ai?.projectId ?? null) : (parsedProject ?? prefill.projectId ?? null);
  // A section belongs to its project (D13); the AI names one only for its project.
  const aiSectionId = projectSource === "ai" ? (ai?.sectionId ?? null) : null;
  const prefillSection = projectId && projectId === prefill.projectId ? (prefill.sectionId ?? null) : null;
  const sectionId = over.sectionId !== undefined ? over.sectionId : (aiSectionId ?? prefillSection);
  const aiLabels = (ai?.labelIds ?? []).flatMap((id) => labels.find((l) => l.id === id)?.name ?? []);
  const labelNames = [...new Set([...parsed.labels, ...(over.labels ?? aiLabels)])];
  const priority: Priority = over.priority ?? ((ai?.priority as Priority | undefined) ?? parsed.priority ?? 4);

  /** Picker handlers: each one is a hand pick of its field. */
  const pick = {
    dueDate: (d: string | null) => setOver((o) => ({ ...o, dueDate: d })),
    dueTime: (t: string | null) => setOver((o) => ({ ...o, dueTime: t })),
    // Picking a repeat may move the date to its first occurrence.
    recurrence: (r: Recurrence | null, firstDate: string | null) => setOver((o) => ({ ...o, recurrence: r, ...(firstDate && firstDate !== dueDate ? { dueDate: firstDate } : {}) })),
    priority: (p: Priority) => setOver((o) => ({ ...o, priority: p })),
    projectId: (id: string | null) => setOver((o) => ({ ...o, projectId: id })),
    // Labels typed in the line stay (remove them by keeping the text); the picker holds the rest.
    labels: (names: string[]) => setOver((o) => ({ ...o, labels: names.filter((n) => !parsed.labels.includes(n)) })),
  };

  return { dueDate, dueTime, recurrence, projectId, sectionId, labelNames, priority, aiHidden, pick, reset };
}
