"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { dueLabel } from "@/lib/tasks/dates";
import type { Priority, Recurrence } from "@/lib/tasks/model";
import { parseQuickAdd, tokenKey, type Token, type TokenKind } from "@/lib/tasks/quick-add";
import { useAppData } from "../app/provider";
import { Icon, type IconName } from "../icons";
import { Dialog } from "../ui/dialog";
import { btn } from "../ui/popover";
import { searchIssues } from "@/lib/client/search";
import { DueInput, priorityLabel, PriorityPicker } from "./bits";
import { AddLinkButton, LinkChip } from "./links";
import { ColorDot, LabelPicker, ProjectPicker } from "./organize";
import { openTask } from "./open-task";
import { useToday } from "./notifications";
import { QuickAddInput, type SuggestFn } from "./quick-add-input";
import { RepeatPicker } from "./schedule";
import { useComposeState, useTasks } from "./store";

/** Token kinds the task model can store so far (later milestones add the rest). */
const ENABLED: ReadonlySet<TokenKind> = new Set<TokenKind>(["date", "time", "recurrence", "priority", "link", "project", "label"]);

const TOKEN_ICON: Record<TokenKind, IconName> = {
  date: "calendar",
  time: "clock",
  recurrence: "refresh",
  priority: "flag",
  label: "tag",
  project: "list",
  link: "link",
};

/** Undefined means "not set by hand": the parsed value (or default) applies. */
type Overrides = { dueDate?: string | null; dueTime?: string | null; recurrence?: Recurrence | null; priority?: Priority; projectId?: string | null; labels?: string[] };

/**
 * Quick add (SPEC §12.4): type the task in one line and properties are picked
 * out as you type. The pickers below show what will be saved and override the
 * parsed values when used.
 */
export function ComposeTask() {
  const { composeOpen, composePrefill } = useComposeState();
  const { closeCompose, create, projects, labels, tasks } = useTasks();
  const { data, byNumber } = useAppData();
  // Links attached outside the text: the item quick add was opened from, or picked by hand.
  const [attached, setAttached] = useState<number[]>([]);
  const [text, setText] = useState("");
  const [ignored, setIgnored] = useState<Set<string>>(new Set());
  const [description, setDescription] = useState("");
  const [showDesc, setShowDesc] = useState(false);
  const [over, setOver] = useState<Overrides>({});
  const [busy, setBusy] = useState(false);
  // Guards double submits within one event (⌘↵ in the title reaches both the
  // input's and the form's key handlers before `busy` re-renders).
  const submitting = useRef(false);
  const { today, now, tz } = useToday();

  useEffect(() => {
    if (!composeOpen) return;
    setText("");
    setIgnored(new Set());
    setDescription("");
    setShowDesc(false);
    setOver({});
    setAttached(composePrefill.links ?? []);
  }, [composeOpen, composePrefill]);

  const activeProjects = useMemo(() => projects.filter((p) => !p.archived), [projects]);
  const projectNames = useMemo(() => activeProjects.map((p) => p.name), [activeProjects]);
  const parsed = useMemo(
    () => parseQuickAdd(text, { today, now, ignored, projects: projectNames, enabled: ENABLED, hasItem: (n) => byNumber.has(n) }),
    [text, today, now, ignored, projectNames, byNumber],
  );

  const dueDate = over.dueDate !== undefined ? over.dueDate : (parsed.dueDate ?? composePrefill.dueDate ?? null);
  const dueTime = dueDate ? (over.dueTime !== undefined ? over.dueTime : parsed.dueTime) : null;
  const parsedRecurrence = parsed.recurrence ? { rule: parsed.recurrence.rule, text: parsed.recurrence.label, fromCompletion: parsed.recurrence.fromCompletion } : null;
  const recurrence = dueDate ? (over.recurrence !== undefined ? over.recurrence : parsedRecurrence) : null;
  const parsedProject = parsed.project ? (activeProjects.find((p) => p.name === parsed.project)?.id ?? null) : null;
  const projectId = over.projectId !== undefined ? over.projectId : (parsedProject ?? composePrefill.projectId ?? null);
  const labelNames = [...new Set([...parsed.labels, ...(over.labels ?? [])])];
  const parent = composePrefill.parentId ? tasks.find((t) => t.id === composePrefill.parentId) : null;
  const priority = over.priority ?? parsed.priority ?? 4;
  const links = [...new Set([...attached, ...parsed.links])];
  // An empty title takes the first linked item's title (§12.1).
  const fallbackTitle = links[0] != null ? (byNumber.get(links[0])?.title ?? "") : "";
  const title = parsed.title;
  const canSubmit = Boolean(title || fallbackTitle);

  const suggest: SuggestFn = (trigger, q) => {
    if (trigger === "=") {
      return activeProjects
        .filter((p) => p.name.toLowerCase().includes(q.toLowerCase()))
        .map((p) => ({ id: `p:${p.id}`, label: p.name, insert: `=${p.name}`, icon: <ColorDot color={p.color} /> }));
    }
    if (trigger === "#") {
      const digits = /^\d+$/.test(q);
      const issueHits = (digits ? data.issues.filter((i) => String(i.number).startsWith(q)) : q ? searchIssues(data.issues, q, 8) : []).slice(0, 8).map((i) => ({
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

  const submit = async (keepOpen: boolean) => {
    if (!canSubmit || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    const t = await create({ title, description, dueDate, dueTime, tz, recurrence, priority, links, projectId, labels: labelNames, parentId: composePrefill.parentId ?? null, sectionId: projectId && projectId === composePrefill.projectId ? (composePrefill.sectionId ?? null) : null });
    submitting.current = false;
    setBusy(false);
    if (!t) return;
    if (keepOpen) {
      setText("");
      setIgnored(new Set());
      setDescription("");
      setOver({});
      setAttached([]);
    } else {
      closeCompose();
      openTask(t.id);
    }
  };

  return (
    <Dialog open={composeOpen} onClose={closeCompose} label="New task" width={600}>
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
          {parent && <p className="mb-1 truncate text-[12px] text-faint">Sub-task of {parent.title}</p>}
          <QuickAddInput
            autoFocus
            label="Task"
            value={text}
            onChange={setText}
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
          {attached.length > 0 && (
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
          <DueInput
            value={dueDate}
            onChange={(d) => setOver((o) => ({ ...o, dueDate: d }))}
            time={dueTime}
            onTimeChange={(t) => setOver((o) => ({ ...o, dueTime: t }))}
            repeat={
              <RepeatPicker
                value={recurrence}
                dueDate={dueDate}
                today={today}
                onChange={(r, firstDate) => setOver((o) => ({ ...o, recurrence: r, ...(firstDate && firstDate !== dueDate ? { dueDate: firstDate } : {}) }))}
              />
            }
          />
          <PriorityPicker value={priority} onChange={(p) => setOver((o) => ({ ...o, priority: p }))} />
          <ProjectPicker value={projectId} onChange={(id) => setOver((o) => ({ ...o, projectId: id }))} />
          <LabelPicker value={labelNames} onChange={(names) => setOver((o) => ({ ...o, labels: names.filter((n) => !parsed.labels.includes(n)) }))} />
          <AddLinkButton linked={links} onAdd={(n) => setAttached((a) => [...a, n])} />
        </div>
        <div className="flex items-center gap-1.5 border-t border-line px-3 py-2.5">
          <span className="min-w-0 flex-1 truncate text-[11.5px] text-faint">
            <b className="font-medium">tomorrow 3pm</b> · <b className="font-medium">every fri</b> · <b className="font-medium">high</b> · <b className="font-medium">#1234</b> · <b className="font-medium">+label</b> · <b className="font-medium">=Project</b> — Backspace on a highlight keeps it as text
          </span>
          <button type="button" onClick={closeCompose} className={btn.ghost}>
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
    </Dialog>
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
