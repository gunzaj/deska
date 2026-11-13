"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { normalizeTaskSuggestion } from "@/lib/ai/task-assist";
import type { ClientIssue } from "@/lib/client/types";
import { dueLabel } from "@/lib/tasks/dates";
import type { TaskLabel, TaskProject, TaskSection } from "@/lib/tasks/model";
import { parseQuickAdd, tokenKey, type Token, type TokenKind } from "@/lib/tasks/quick-add";
import { useAppData } from "../app/provider";
import { useTasksOnly } from "../app/tasks-only";
import { Icon, type IconName } from "../icons";
import { Dialog } from "../ui/dialog";
import { btn } from "../ui/popover";
import { searchIssues } from "@/lib/client/search";
import { aiCall, TaskAssistChips, useTaskAssist, type TaskAssistChoices } from "./ai-task-assist";
import { useComposeFields } from "./compose-fields";
import { DueInput, priorityLabel, PriorityPicker } from "./bits";
import { AddLinkButton, LinkChip } from "./links";
import { ColorDot, LabelPickerFor, ProjectPickerFor } from "./organize";
import { openTask } from "./open-task";
import { useToday } from "./notifications";
import { QuickAddInput, type SuggestFn } from "./quick-add-input";
import { RepeatPicker } from "./schedule";
import { useComposeState, useTasks, type ComposePrefill, type CreateInput } from "./store";

/** Token kinds the task model can store so far (later milestones add the rest). */
const ENABLED: ReadonlySet<TokenKind> = new Set<TokenKind>(["date", "time", "recurrence", "priority", "link", "project", "label"]);
/** Without issue data (the floating window) `#1234` stays text. */
const ENABLED_NO_LINKS: ReadonlySet<TokenKind> = new Set<TokenKind>(["date", "time", "recurrence", "priority", "project", "label"]);

const TOKEN_ICON: Record<TokenKind, IconName> = {
  date: "calendar",
  time: "clock",
  recurrence: "refresh",
  priority: "flag",
  label: "tag",
  project: "list",
  link: "link",
};

/**
 * Quick add (SPEC §12.4) from inside the app: the sidebar's +, `Q`, the palette
 * and "Add to tasks". The form is the same one the floating window shows.
 */
export function ComposeTask() {
  const { composeOpen, composePrefill } = useComposeState();
  const { closeCompose, create, projects, labels, sections, tasks } = useTasks();
  const { data, byNumber } = useAppData();
  const tasksOnly = useTasksOnly();
  const clock = useToday();
  const issues = useMemo(() => ({ list: data.issues, byNumber }), [data.issues, byNumber]);
  const parent = composePrefill.parentId ? tasks.find((t) => t.id === composePrefill.parentId) : null;
  return (
    <Dialog open={composeOpen} onClose={closeCompose} label="New task" width={600}>
      <ComposeForm
        projects={projects}
        labels={labels}
        sections={sections}
        issues={issues}
        canAddLinks={!tasksOnly}
        prefill={composePrefill}
        parentTitle={parent?.title ?? null}
        clock={clock}
        onCreate={create}
        onCancel={closeCompose}
        onCreated={(id) => {
          closeCompose();
          openTask(id);
        }}
      />
    </Dialog>
  );
}

const NO_PREFILL: ComposePrefill = {};

export type ComposeClock = { today: string; now: string; tz: string };

/**
 * The quick-add form (SPEC §12.4): type the task in one line and properties are
 * picked out as you type. The pickers under the line show what will be saved
 * and set any property with the mouse, overriding the parse.
 *
 * `issues` enables `#1234` links (the floating window has no issue data);
 * `onCreate` saves and gives the new task's id, or null when it failed;
 * `onCreated` runs after a save that closes the form ("Add another" keeps it open).
 */
export function ComposeForm({
  projects,
  labels,
  sections,
  issues = null,
  canAddLinks = false,
  prefill = NO_PREFILL,
  parentTitle = null,
  clock,
  onCreate,
  onCancel,
  onCreated,
  error,
}: {
  projects: TaskProject[];
  labels: TaskLabel[];
  sections: TaskSection[];
  issues?: { list: ClientIssue[]; byNumber: Map<number, ClientIssue> } | null;
  canAddLinks?: boolean;
  prefill?: ComposePrefill;
  parentTitle?: string | null;
  clock: ComposeClock;
  onCreate: (input: CreateInput) => Promise<{ id: string } | null>;
  onCancel: () => void;
  onCreated: (id: string) => void;
  /** A save failure the caller shows (the in-app store has its own banner). */
  error?: ReactNode;
}) {
  // Links attached outside the text: the item quick add was opened from, or picked by hand.
  const [attached, setAttached] = useState<number[]>([]);
  const [text, setText] = useState("");
  const [ignored, setIgnored] = useState<Set<string>>(new Set());
  const [description, setDescription] = useState("");
  const [showDesc, setShowDesc] = useState(false);
  const [busy, setBusy] = useState(false);
  // Guards double submits within one event (⌘↵ in the title reaches both the
  // input's and the form's key handlers before `busy` re-renders).
  const submitting = useRef(false);
  const assist = useTaskAssist();
  const { today, now, tz } = clock;
  const byNumber = issues?.byNumber;

  const activeProjects = useMemo(() => projects.filter((p) => !p.archived), [projects]);
  const projectNames = useMemo(() => activeProjects.map((p) => p.name), [activeProjects]);
  const parsed = useMemo(
    () => parseQuickAdd(text, { today, now, ignored, projects: projectNames, enabled: byNumber ? ENABLED : ENABLED_NO_LINKS, hasItem: byNumber ? (n) => byNumber.has(n) : undefined }),
    [text, today, now, ignored, projectNames, byNumber],
  );

  // The same suggestion shape Tidy Inbox shows; fix impossible combinations (a
  // section of another project, a time or recurrence without a date) first.
  const ai = useMemo(
    () =>
      assist.suggestion
        ? normalizeTaskSuggestion(
            {
              projects: activeProjects.map((p) => ({ id: p.id, name: p.name, sections: sections.filter((s) => s.projectId === p.id).map((s) => ({ id: s.id, name: s.name })) })),
              labels: labels.map((l) => ({ id: l.id, name: l.name })),
              current: null,
            },
            assist.suggestion,
          )
        : null,
    [assist.suggestion, activeProjects, sections, labels],
  );
  const aiChoices = useMemo<TaskAssistChoices>(
    () => ({ projects: activeProjects, sections, labels, today, issueTitle: byNumber ? (n) => byNumber.get(n)?.title : undefined }),
    [activeProjects, sections, labels, today, byNumber],
  );

  const fields = useComposeFields({ parsed, raw: assist.suggestion, ai, projects: activeProjects, labels, prefill });
  const { dueDate, dueTime, recurrence, projectId, sectionId, labelNames, priority } = fields;

  // A new prefill (quick add opened again from somewhere else) starts over.
  const resetAssist = assist.reset;
  const resetFields = fields.reset;
  useEffect(() => {
    setText("");
    setIgnored(new Set());
    setDescription("");
    setShowDesc(false);
    resetFields();
    setAttached(prefill.links ?? []);
    resetAssist();
  }, [prefill, resetAssist, resetFields]);

  const aiIssue = ai?.issueNumber != null ? Number(ai.issueNumber) : null;
  const links = [...new Set([...attached, ...parsed.links, ...(aiIssue != null ? [aiIssue] : [])])];
  // An empty title takes the first linked item's title (§12.1).
  const fallbackTitle = links[0] != null ? (byNumber?.get(links[0])?.title ?? "") : "";
  const title = ai?.title ?? parsed.title;
  const canSubmit = Boolean(title || fallbackTitle);

  const suggest: SuggestFn = (trigger, q) => {
    if (trigger === "=") {
      return activeProjects
        .filter((p) => p.name.toLowerCase().includes(q.toLowerCase()))
        .map((p) => ({ id: `p:${p.id}`, label: p.name, insert: `=${p.name}`, icon: <ColorDot color={p.color} /> }));
    }
    if (trigger === "#" && issues) {
      const digits = /^\d+$/.test(q);
      const issueHits = (digits ? issues.list.filter((i) => String(i.number).startsWith(q)) : q ? searchIssues(issues.list, q, 8) : []).slice(0, 8).map((i) => ({
        n: i.number,
        id: `#${i.number}`,
        label: i.title,
        insert: `#${i.number}`,
        icon: <span className="font-mono text-[11px] text-faint">#{i.number}</span>,
        hint: i.state === "closed" ? "closed" : undefined,
      }));
      // A number query lists issues by number; a text query keeps the search ranking.
      const items = digits ? [...issueHits].sort((a, b) => a.n - b.n) : issueHits;
      return items.map(({ n: _n, ...rest }) => rest);
    }
    if (trigger === "+") {
      const needle = q.toLowerCase();
      const found = labels.filter((l) => l.name.toLowerCase().includes(needle)).map((l) => ({ id: `+${l.id}`, label: l.name, insert: `+${l.name}`, icon: <ColorDot color={l.color} size={7} shape="tag" /> }));
      const fresh = q && /^\p{L}[\p{L}\p{N}_-]*$/u.test(q) && !labels.some((l) => l.name.toLowerCase() === needle) ? [{ id: `+new:${q}`, label: `Create label “${q}”`, insert: `+${q}`, icon: <Icon name="plus" size={12} className="text-faint" /> }] : [];
      return [...found, ...fresh];
    }
    return [];
  };

  const revert = (key: string) => setIgnored((prev) => new Set(prev).add(key));

  // Typing changes the line the suggestion was for: drop it (SPEC §4.9).
  const changeText = (v: string) => {
    if (assist.suggestion || assist.phase !== "idle" || assist.error) assist.reset();
    setText(v);
  };

  const submit = async (keepOpen: boolean) => {
    if (!canSubmit || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    const resultId = assist.resultId;
    const t = await onCreate({ title, description, dueDate, dueTime, tz, recurrence, priority, links, projectId, labels: labelNames, parentId: prefill.parentId ?? null, sectionId });
    submitting.current = false;
    setBusy(false);
    if (!t) return;
    // The suggestion became the task: record it accepted (SPEC §4.9). Accepting a
    // task change is a normal local edit, so this is bookkeeping, not a write gate.
    assist.reset();
    if (resultId) void aiCall(`/api/ai/results/${resultId}/outcome`, "POST", { outcome: "accepted" }).catch(() => null);
    if (keepOpen) {
      setText("");
      setIgnored(new Set());
      setDescription("");
      fields.reset();
      setAttached([]);
    } else {
      onCreated(t.id);
    }
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit(false);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !e.defaultPrevented) {
          e.preventDefault();
          void submit(false);
        }
      }}
    >
      <div className="px-4 pt-4">
        {parentTitle && <p className="mb-1 truncate text-[12px] text-faint">Sub-task of {parentTitle}</p>}
        <QuickAddInput
          autoFocus
          label="Task"
          value={text}
          onChange={changeText}
          tokens={parsed.tokens}
          onRevert={revert}
          onSubmit={() => void submit(false)}
          suggest={suggest}
          placeholder={fallbackTitle ? `What to do? Empty uses “${fallbackTitle}”` : "e.g. Finish the send flow spec tomorrow high @bob"}
        />
        {parsed.tokens.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Recognised properties">
            {parsed.tokens.map((t) => (
              <TokenChip key={`${t.kind}:${t.start}`} token={t} today={today} onRevert={() => revert(tokenKey(t.kind, t.text))} />
            ))}
          </div>
        )}
        {(assist.phase === "checking" || assist.phase === "running") && (
          <p role="status" className="mt-2 flex items-center gap-2 text-[12.5px] text-muted" data-ai-assist-progress>
            <span className="size-3 animate-spin rounded-full border-2 border-line border-t-brand" aria-label="Asking the model" />
            {assist.phase === "checking" ? "Checking AI assist…" : "Asking the model…"}
            <button type="button" onClick={() => void assist.cancel()} className={btn.ghost}>
              Cancel
            </button>
          </p>
        )}
        {ai && (
          <div className="mt-2">
            <TaskAssistChips suggestion={ai} choices={aiChoices} hidden={fields.aiHidden} onRemove={assist.removeField} onDismiss={assist.dismiss} />
          </div>
        )}
        {assist.error && (
          <p role="alert" className="mt-2 text-[12.5px] text-critical" data-ai-assist-error>
            {assist.error.kind === "failed" ? `AI unavailable — ${assist.error.message}` : assist.error.message}
          </p>
        )}
        {attached.length > 0 && byNumber && (
          <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Attached">
            {attached.map((n) => (
              <span key={n} className="inline-flex items-center">
                <LinkChip link={{ kind: "issue", nodeId: byNumber.get(n)?.nodeId ?? "", number: n }} compact />
                <button type="button" onClick={() => setAttached((a) => a.filter((x) => x !== n))} aria-label={`Detach #${n}`} className="grid size-5 place-items-center rounded-full text-faint hover:bg-hover hover:text-fg">
                  <Icon name="x" size={11} />
                </button>
              </span>
            ))}
          </div>
        )}
        {showDesc ? (
          <textarea
            aria-label="Description"
            autoFocus
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description (markdown)"
            rows={3}
            className="mt-2 w-full resize-none bg-transparent text-[13px] outline-none placeholder:text-faint"
          />
        ) : (
          <button type="button" onClick={() => setShowDesc(true)} className="mt-1.5 text-[12.5px] text-faint hover:text-muted">
            + Description
          </button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1.5 px-3 pb-3 pt-2">
        <DueInput value={dueDate} onChange={fields.pick.dueDate} time={dueTime} onTimeChange={fields.pick.dueTime} repeat={<RepeatPicker value={recurrence} dueDate={dueDate} today={today} onChange={fields.pick.recurrence} />} />
        <PriorityPicker value={priority} onChange={fields.pick.priority} />
        <ProjectPickerFor projects={projects} value={projectId} onChange={fields.pick.projectId} />
        <LabelPickerFor labels={labels} value={labelNames} onChange={fields.pick.labels} />
        {issues && canAddLinks && <AddLinkButton linked={links} onAdd={(n) => setAttached((a) => [...a, n])} />}
      </div>
      {error && (
        <p role="alert" className="px-4 pb-2 text-[12.5px] text-critical">
          {error}
        </p>
      )}
      <div className="flex items-center gap-1.5 border-t border-line px-3 py-2.5">
        <span className="min-w-0 flex-1 truncate text-[11.5px] text-faint">
          <b className="font-medium">tomorrow 3pm</b> · <b className="font-medium">every fri</b> · <b className="font-medium">high</b> {issues && canAddLinks && (<> · <b className="font-medium">#1234</b></>)} · <b className="font-medium">+label</b> · <b className="font-medium">=Project</b> — Backspace on a highlight keeps it as text
        </span>
        <button
          type="button"
          onClick={() => void assist.run(text, { today, now, tz })}
          className={btn.ghost}
          disabled={!text.trim() || busy || assist.phase === "checking" || assist.phase === "running"}
          title="Ask the model to fill in the task's properties"
          data-ai-assist
        >
          <Icon name="zap" size={13} />
          AI assist
        </button>
        <button type="button" onClick={onCancel} className={btn.ghost}>
          Cancel
        </button>
        <button type="button" disabled={!canSubmit || busy} onClick={() => void submit(true)} className={btn.outline}>
          Add another
        </button>
        <button type="submit" disabled={!canSubmit || busy} className={btn.primary}>
          Add task
        </button>
      </div>
    </form>
  );
}

function TokenChip({ token, today, onRevert }: { token: Token; today: string; onRevert: () => void }) {
  const text =
    token.kind === "date"
      ? dueLabel(token.date, today).text
      : token.kind === "time"
        ? token.time
        : token.kind === "recurrence"
          ? token.label
          : token.kind === "priority"
            ? priorityLabel(token.priority)
            : token.kind === "label"
              ? token.name
              : token.kind === "project"
                ? token.name
                : `#${token.number}`;
  return (
    <span className="inline-flex h-6 items-center gap-1 rounded-full border border-line bg-surface pl-2 pr-0.5 text-[12px] text-muted">
      <Icon name={TOKEN_ICON[token.kind]} size={12} className="text-faint" />
      {text}
      <button type="button" onClick={onRevert} aria-label={`Keep "${token.text}" as text`} title="Keep as text" className="grid size-5 place-items-center rounded-full text-faint hover:bg-hover hover:text-fg">
        <Icon name="x" size={11} />
      </button>
    </span>
  );
}
