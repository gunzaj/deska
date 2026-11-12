"use client";

import { useEffect, useRef, useState } from "react";
import { TASK_COLORS, type TaskLabel, type TaskProject } from "@/lib/tasks/model";
import { Icon } from "../icons";
import { Dialog } from "../ui/dialog";
import { btn, PickList, Popover, type PickItem } from "../ui/popover";
import { useTasks } from "./store";

// Projects and labels (SPEC §12.3): colour dots, pickers and the project form.

/** Mid-tone swatches that read on both themes (dots only, never text). */
const COLOR_HEX: Record<string, string> = {
  grey: "#8a8f98",
  red: "#e5484d",
  orange: "#f76b15",
  yellow: "#e2a336",
  green: "#30a46c",
  teal: "#12a594",
  blue: "#0090ff",
  violet: "#8e4ec6",
  pink: "#d6409f",
};

export function ColorDot({ color, size = 8, shape = "circle" }: { color: string; size?: number; shape?: "circle" | "tag" }) {
  return (
    <span
      aria-hidden
      className={`inline-block shrink-0 ${shape === "circle" ? "rounded-full" : "rounded-[2px] rotate-45"}`}
      style={{ width: size, height: size, background: COLOR_HEX[color] ?? COLOR_HEX.grey }}
    />
  );
}

export function LabelChip({ label }: { label: TaskLabel }) {
  return (
    <span className="inline-flex h-5 items-center gap-1 rounded-full px-1.5 text-[11.5px] text-muted" style={{ background: `color-mix(in srgb, ${COLOR_HEX[label.color] ?? COLOR_HEX.grey} 14%, transparent)` }}>
      <ColorDot color={label.color} size={6} shape="tag" />
      {label.name}
    </span>
  );
}

const INBOX = "__inbox";

export function ProjectPicker({ value, onChange }: { value: string | null; onChange: (id: string | null) => void }) {
  const { projects } = useTasks();
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const active = projects.filter((p) => !p.archived);
  const current = projects.find((p) => p.id === value);
  const items: PickItem[] = [
    { id: INBOX, label: "Inbox", icon: <Icon name="inbox" size={13} className="text-faint" />, checked: value == null },
    ...active.map((p) => ({ id: p.id, label: p.name, icon: <ColorDot color={p.color} />, checked: p.id === value })),
  ];
  return (
    <>
      <button ref={anchor} type="button" onClick={() => setOpen(true)} className={btn.ghost} aria-label={`Project: ${current?.name ?? "Inbox"}`}>
        {current ? <ColorDot color={current.color} /> : <Icon name="inbox" size={13} className="text-faint" />}
        {current?.name ?? "Inbox"}
      </button>
      <Popover anchor={anchor} open={open} onClose={() => setOpen(false)} width={240}>
        <PickList
          items={items}
          placeholder="Move to project…"
          emptyText="No projects"
          onPick={(id) => {
            onChange(id === INBOX ? null : id);
            setOpen(false);
          }}
        />
      </Popover>
    </>
  );
}

/** Multi-select over the viewer's labels; typing a new name offers to create it. */
export function LabelPicker({ value, onChange }: { value: string[]; onChange: (names: string[]) => void }) {
  const { labels } = useTasks();
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const chosen = new Set(value.map((n) => n.toLowerCase()));
  const names = [...new Set([...labels.map((l) => l.name), ...value])];
  const needle = q.trim();
  const items: PickItem[] = [
    ...names.filter((n) => n.toLowerCase().includes(needle.toLowerCase())).map((n) => {
      const l = labels.find((x) => x.name === n);
      return { id: n, label: n, icon: <ColorDot color={l?.color ?? "grey"} size={7} shape="tag" />, checked: chosen.has(n.toLowerCase()) };
    }),
    ...(needle && !names.some((n) => n.toLowerCase() === needle.toLowerCase())
      ? [{ id: `+${needle}`, label: `Create “${needle}”`, icon: <Icon name="plus" size={13} className="text-faint" /> }]
      : []),
  ];
  return (
    <>
      <button ref={anchor} type="button" onClick={() => setOpen(true)} className={btn.ghost} aria-label="Labels">
        <Icon name="tag" size={13} />
        {value.length ? value.join(", ") : "Labels"}
      </button>
      <Popover anchor={anchor} open={open} onClose={() => setOpen(false)} width={240}>
        <PickList
          multi
          items={items}
          onSearch={setQ}
          placeholder="Label…"
          emptyText="Type to create a label"
          onPick={(id) => {
            const name = id.startsWith("+") ? id.slice(1) : id;
            onChange(chosen.has(name.toLowerCase()) ? value.filter((n) => n.toLowerCase() !== name.toLowerCase()) : [...value, name]);
          }}
        />
      </Popover>
    </>
  );
}

/** Create or edit a project: name and colour. */
export function ProjectDialog({ open, onClose, project }: { open: boolean; onClose: () => void; project?: TaskProject }) {
  const { createProject, updateProject } = useTasks();
  const [name, setName] = useState("");
  const [color, setColor] = useState("grey");
  // Reset on open only: `project` is a new object after every task reload,
  // which must not wipe what is being typed.
  const initial = useRef(project);
  initial.current = project;
  useEffect(() => {
    if (!open) return;
    setName(initial.current?.name ?? "");
    setColor(initial.current?.color ?? "blue");
  }, [open, project?.id]);
  const save = async () => {
    const n = name.trim();
    if (!n) return;
    const ok = project ? await updateProject(project.id, { name: n, color }) : Boolean(await createProject(n, color));
    if (ok) onClose();
  };
  return (
    <Dialog open={open} onClose={onClose} label={project ? "Edit project" : "New project"} width={400}>
      <form
        className="p-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <p className="text-[14px] font-semibold">{project ? "Edit project" : "New project"}</p>
        <input
          autoFocus
          aria-label="Project name"
          value={name}
          maxLength={60}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Specs to finish"
          className="mt-3 h-9 w-full rounded-lg border border-line-field bg-field px-3 text-[14px] outline-none focus:border-focus"
        />
        <div className="mt-3 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Colour">
          {TASK_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={color === c}
              aria-label={c}
              onClick={() => setColor(c)}
              className={`grid size-7 place-items-center rounded-md ${color === c ? "bg-active" : "hover:bg-hover"}`}
            >
              <ColorDot color={c} size={12} />
            </button>
          ))}
        </div>
        <div className="mt-4 flex justify-end gap-1.5">
          <button type="button" onClick={onClose} className={btn.outline}>
            Cancel
          </button>
          <button type="submit" disabled={!name.trim()} className={btn.primary}>
            {project ? "Save" : "Create project"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/** Create a label from the sidebar. */
export function NewLabelDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { createLabel } = useTasks();
  const [name, setName] = useState("");
  const [color, setColor] = useState("blue");
  useEffect(() => {
    if (!open) return;
    setName("");
    setColor("blue");
  }, [open]);
  const save = async () => {
    const n = name.trim();
    if (n && (await createLabel(n, color))) onClose();
  };
  return (
    <Dialog open={open} onClose={onClose} label="New label" width={400}>
      <form
        className="p-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <p className="text-[14px] font-semibold">New label</p>
        <input
          autoFocus
          aria-label="Label name"
          value={name}
          maxLength={60}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. waiting"
          className="mt-3 h-9 w-full rounded-lg border border-line-field bg-field px-3 text-[14px] outline-none focus:border-focus"
        />
        <div className="mt-3 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Colour">
          {TASK_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={color === c}
              aria-label={c}
              onClick={() => setColor(c)}
              className={`grid size-7 place-items-center rounded-md ${color === c ? "bg-active" : "hover:bg-hover"}`}
            >
              <ColorDot color={c} size={12} />
            </button>
          ))}
        </div>
        <div className="mt-4 flex justify-end gap-1.5">
          <button type="button" onClick={onClose} className={btn.outline}>
            Cancel
          </button>
          <button type="submit" disabled={!name.trim()} className={btn.primary}>
            Create label
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/** Rename, recolour or delete one of my labels. */
export function LabelDialog({ open, onClose, label, onDeleted }: { open: boolean; onClose: () => void; label: TaskLabel; onDeleted: () => void }) {
  const { updateLabel, deleteLabel } = useTasks();
  const [name, setName] = useState(label.name);
  const [color, setColor] = useState(label.color);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Reset on open only; `label` is a new object after every reload (see ProjectDialog).
  const initial = useRef(label);
  initial.current = label;
  useEffect(() => {
    if (!open) return;
    setName(initial.current.name);
    setColor(initial.current.color);
    setConfirmDelete(false);
  }, [open, label.id]);
  const save = async () => {
    const n = name.trim();
    if (n && (await updateLabel(label.id, { name: n, color }))) onClose();
  };
  return (
    <Dialog open={open} onClose={onClose} label="Edit label" width={400}>
      <form
        className="p-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <p className="text-[14px] font-semibold">Edit label</p>
        <input
          autoFocus
          aria-label="Label name"
          value={name}
          maxLength={60}
          onChange={(e) => setName(e.target.value)}
          className="mt-3 h-9 w-full rounded-lg border border-line-field bg-field px-3 text-[14px] outline-none focus:border-focus"
        />
        <div className="mt-3 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Colour">
          {TASK_COLORS.map((c) => (
            <button key={c} type="button" role="radio" aria-checked={color === c} aria-label={c} onClick={() => setColor(c)} className={`grid size-7 place-items-center rounded-md ${color === c ? "bg-active" : "hover:bg-hover"}`}>
              <ColorDot color={c} size={11} shape="tag" />
            </button>
          ))}
        </div>
        <div className="mt-4 flex items-center gap-1.5">
          {confirmDelete ? (
            <button
              type="button"
              onClick={() =>
                void deleteLabel(label.id).then((ok) => {
                  if (ok) {
                    onClose();
                    onDeleted();
                  }
                })
              }
              className="inline-flex h-7 items-center rounded-md bg-[var(--prio-1)] px-2.5 text-[12.5px] font-semibold text-white hover:opacity-90"
            >
              Really delete “{label.name}”?
            </button>
          ) : (
            <button type="button" onClick={() => setConfirmDelete(true)} className={btn.ghost}>
              <Icon name="trash" size={13} /> Delete
            </button>
          )}
          <span className="flex-1" />
          <button type="button" onClick={onClose} className={btn.outline}>
            Cancel
          </button>
          <button type="submit" disabled={!name.trim()} className={btn.primary}>
            Save
          </button>
        </div>
      </form>
    </Dialog>
  );
}
