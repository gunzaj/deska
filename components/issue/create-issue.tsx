"use client";

// Create an issue (SPEC §4.8, W3): title, body, Type, labels, assignees,
// milestone and the mapped fields, sent as one outbox job. The local row shows
// "pending" until GitHub confirms it (the pending strip in the lists), and the
// issue appears once after the job re-reads it. While writes are off the form is
// visible with the reason and Create is disabled.
import { useEffect, useMemo, useRef, useState } from "react";
import { EDITING_OFF } from "@/lib/client/edit";
import { plainName } from "@/lib/client/format";
import { useAppData } from "../app/provider";
import { Icon, type IconName } from "../icons";
import { Dialog } from "../ui/dialog";
import { btn, PickList, Popover } from "../ui/popover";
import { useToast } from "../ui/toast";

/** Ask the shell to open the create dialog (the sidebar's + and the palette). */
export const CREATE_ISSUE_EVENT = "deska:create-issue";
export function openCreateIssue() {
  window.dispatchEvent(new CustomEvent(CREATE_ISSUE_EVENT));
}

type Form = {
  title: string;
  body: string;
  typeId: string;
  milestoneId: string;
  labelIds: Set<string>;
  assigneeLogins: Set<string>;
  /** Mapped field key (status, priority, release, dim:<field ID>) -> option ID. */
  fields: Record<string, string>;
};

const empty = (): Form => ({ title: "", body: "", typeId: "", milestoneId: "", labelIds: new Set(), assigneeLogins: new Set(), fields: {} });

export function CreateIssue() {
  const { data, refresh } = useAppData();
  const meta = data.meta;
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Form>(empty);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onOpen = () => {
      setForm(empty());
      setError(null);
      setOpen(true);
    };
    window.addEventListener(CREATE_ISSUE_EVENT, onOpen);
    return () => window.removeEventListener(CREATE_ISSUE_EVENT, onOpen);
  }, []);

  const mapped = useMemo(() => {
    const rows: { key: string; label: string; options: { id: string; name: string }[] }[] = [];
    if (meta.mapping.status) rows.push({ key: "status", label: "Status", options: meta.fields.status });
    if (meta.mapping.priority) rows.push({ key: "priority", label: "Priority", options: meta.fields.priority });
    if (meta.mapping.sprint) rows.push({ key: "release", label: "Release", options: meta.releases.map((r) => ({ id: r.id, name: r.title })) });
    for (const d of meta.dimensions) if (!d.missing) rows.push({ key: d.key, label: d.name, options: d.options });
    return rows;
  }, [meta]);

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/issues", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: form.title.trim(),
          body: form.body,
          typeId: form.typeId || null,
          milestoneId: form.milestoneId || null,
          labelIds: [...form.labelIds],
          assigneeLogins: [...form.assigneeLogins],
          fields: Object.entries(form.fields)
            .filter(([, v]) => v)
            .map(([field, next]) => ({ field, next })),
        }),
      });
      const out = (await res.json().catch(() => null)) as { entry?: { status?: string; error?: string | null; result?: { number?: number } | null }; error?: string } | null;
      if (!res.ok) {
        const made = out?.entry?.result?.number;
        // GitHub made the issue and a later step failed (adding it to the
        // project, a field): the issue exists, so the form closes. Left open, the
        // only thing to do was Create again, which made a second issue.
        if (made) {
          setOpen(false);
          await refresh();
          toast({ message: createdWithProblem(made, out?.entry?.error) });
          return;
        }
        throw new Error(out?.error ?? out?.entry?.error ?? `Request failed (${res.status})`);
      }
      setOpen(false);
      // The create job re-read the issue into the cache: the list shows it once.
      await refresh();
      const number = out?.entry?.result?.number;
      toast({
        message:
          res.status === 201
            ? number
              ? `Created #${number}.`
              : "Created."
            : "Queued: GitHub has not confirmed it yet, so it shows as pending.",
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  const writesOff = !meta.writeMode;
  return (
    <Dialog open={open} onClose={() => setOpen(false)} label="Create issue" width={560}>
      {open && (
        <form
          className="space-y-3 p-4"
          data-create-issue
          onSubmit={(e) => {
            e.preventDefault();
            if (!writesOff && form.title.trim() && !saving) void submit();
          }}
        >
          <p className="text-[14px] font-semibold">New issue</p>
          {writesOff && (
            <p role="note" className="text-[12.5px] text-muted">
              {meta.editOffReason ?? EDITING_OFF}: creating an issue is off. You can fill the form; Create stays disabled.
            </p>
          )}
          {error && (
            <p role="alert" className="text-[12.5px] font-medium text-critical">
              {error}
            </p>
          )}
          <label className="block text-[12.5px] font-medium">
            Title
            <input
              autoFocus
              aria-label="Title"
              className="mt-1 h-8 w-full rounded-md border border-line bg-surface px-2 text-[13px]"
              value={form.title}
              maxLength={256}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </label>
          <label className="block text-[12.5px] font-medium">
            Description (Markdown)
            <textarea
              aria-label="Description"
              className="mt-1 min-h-24 w-full rounded-md border border-line bg-surface px-2 py-1.5 text-[13px]"
              value={form.body}
              onChange={(e) => setForm({ ...form, body: e.target.value })}
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <Select
              label="Type"
              value={form.typeId}
              options={meta.issueTypes.map((t) => ({ id: t.id, name: plainName(t.name) || t.name }))}
              onChange={(typeId) => setForm({ ...form, typeId })}
            />
            <Select
              label="Milestone"
              value={form.milestoneId}
              options={meta.milestones.map((m) => ({ id: m.id, name: m.title }))}
              onChange={(milestoneId) => setForm({ ...form, milestoneId })}
            />
            {mapped.map((f) => (
              <Select
                key={f.key}
                label={f.label}
                value={form.fields[f.key] ?? ""}
                options={f.options.map((o) => ({ id: o.id, name: plainName(o.name) || o.name }))}
                onChange={(id) => {
                  const fields = { ...form.fields };
                  if (id) fields[f.key] = id;
                  else delete fields[f.key];
                  setForm({ ...form, fields });
                }}
              />
            ))}
          </div>

          {/* Labels and assignees: searchable pickers with chips, not a wall of checkboxes. */}
          <div className="flex flex-wrap items-start gap-x-3 gap-y-1.5">
            <ChipPicker
              noun="label"
              icon="tag"
              items={meta.labels.map((l) => ({ id: l.id, name: l.name }))}
              selected={form.labelIds}
              onToggle={(id) => setForm((f) => ({ ...f, labelIds: toggled(f.labelIds, id) }))}
              emptyText={meta.labels.length ? "No labels match" : "This repository has no labels."}
              data="labels"
            />
            {meta.users.length > 0 && (
              <ChipPicker
                noun="assignee"
                icon="user"
                items={meta.users.map((u) => ({ id: u.login, name: u.login }))}
                selected={form.assigneeLogins}
                onToggle={(login) => setForm((f) => ({ ...f, assigneeLogins: toggled(f.assigneeLogins, login) }))}
                emptyText="No people match"
                data="assignees"
              />
            )}
          </div>

          <div className="sticky bottom-0 -mx-4 -mb-4 flex justify-end gap-1.5 border-t border-line-soft bg-popover px-4 py-3">
            <button type="button" onClick={() => setOpen(false)} className={btn.ghost}>
              Cancel
            </button>
            <button type="submit" className={btn.outline} disabled={writesOff || saving || !form.title.trim()} title={writesOff ? (meta.editOffReason ?? EDITING_OFF) : undefined} data-create-submit>
              {saving ? "Creating…" : "Create issue"}
            </button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

function Select({ label, value, options, onChange }: { label: string; value: string; options: { id: string; name: string }[]; onChange: (id: string) => void }) {
  return (
    <label className="block text-[12.5px] font-medium">
      {label}
      <select
        aria-label={label}
        className="mt-1 h-8 w-full rounded-md border border-line bg-surface px-2 text-[13px]"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">No {label.toLowerCase()}</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function toggled(set: Set<string>, id: string): Set<string> {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/** A trigger button that opens a searchable multi-pick, with the picks shown as removable chips. */
function ChipPicker({
  noun,
  icon,
  items,
  selected,
  onToggle,
  emptyText,
  data,
}: {
  noun: string;
  icon: IconName;
  items: { id: string; name: string }[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  emptyText: string;
  /** Suffix for the data-create-* hooks the tests use. */
  data: string;
}) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const Noun = noun[0]!.toUpperCase() + noun.slice(1);
  const picked = items.filter((i) => selected.has(i.id));
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button ref={anchor} type="button" onClick={() => setOpen(true)} className={btn.outline} aria-label={`${Noun}s`} data-create-trigger={data}>
        <Icon name={icon} size={13} />
        {selected.size ? `${selected.size} ${noun}${selected.size === 1 ? "" : "s"}` : `${Noun}s`}
      </button>
      {picked.length > 0 && (
        <div className="flex flex-wrap gap-1" data-create-chips={data}>
          {picked.map((i) => (
            <span key={i.id} className="inline-flex h-6 items-center gap-1 rounded-md border border-line bg-surface px-1.5 text-[11.5px] font-medium">
              {i.name}
              <button type="button" aria-label={`Remove ${noun} ${i.name}`} onClick={() => onToggle(i.id)} className="text-faint hover:text-fg">
                <Icon name="x" size={11} />
              </button>
            </span>
          ))}
        </div>
      )}
      <Popover anchor={anchor} open={open} onClose={() => setOpen(false)} width={280}>
        <PickList multi items={items.map((i) => ({ id: i.id, label: i.name, checked: selected.has(i.id) }))} onPick={onToggle} placeholder={`Search ${noun}s…`} emptyText={emptyText} />
      </Popover>
    </div>
  );
}

/** What the form says when the issue was created but a later step of the job failed. */
export function createdWithProblem(number: number, error: string | null | undefined): string {
  return `Created #${number}, but not everything was set${error ? `: ${error}` : "."} Open the issue to finish it.`;
}
