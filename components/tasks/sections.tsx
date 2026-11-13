"use client";

import { useEffect, useRef, useState } from "react";
import type { TaskSection } from "@/lib/tasks/model";
import { Icon } from "../icons";
import { Dialog } from "../ui/dialog";
import { btn, PickList, Popover, type PickItem } from "../ui/popover";
import { nameTaken } from "@/lib/client/task-names";
import { DialogError, useSubmit } from "./organize";
import { useTasks } from "./store";

// Sections of a project (SPEC §4.6, D13): the name dialog, the header menu and
// the picker in the task panel.

/** Name a new section of `projectId`, or rename `section`. */
export function SectionDialog({ open, onClose, projectId, section }: { open: boolean; onClose: () => void; projectId: string; section?: TaskSection | null }) {
  const { createSection, updateSection, sections } = useTasks();
  const submit = useSubmit(open);
  const [name, setName] = useState("");
  const initial = useRef(section);
  initial.current = section;
  // Reset on open only: `section` is a new object after every reload.
  useEffect(() => {
    if (open) setName(initial.current?.name ?? "");
  }, [open, section?.id]);
  const save = async () => {
    const n = name.trim();
    if (!n) return;
    if (nameTaken(sections.filter((x) => x.projectId === projectId), n, section?.id)) return submit.setError(`A section named “${n}” already exists.`);
    await submit.run(async (onError) => (section ? await updateSection(section.id, { name: n }, onError) : Boolean(await createSection(projectId, n, onError))), onClose);
  };
  return (
    <Dialog open={open} onClose={onClose} label={section ? "Rename section" : "New section"} width={400}>
      <form
        className="p-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <p className="text-[14px] font-semibold">{section ? "Rename section" : "New section"}</p>
        <input
          autoFocus
          aria-label="Section name"
          value={name}
          maxLength={60}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Waiting on review"
          className="mt-3 h-9 w-full rounded-lg border border-line-field bg-field px-3 text-[14px] outline-none focus:border-focus"
        />
        <DialogError error={submit.error} />
        <div className="mt-4 flex justify-end gap-1.5">
          <button type="button" onClick={onClose} className={btn.outline}>
            Cancel
          </button>
          <button type="submit" disabled={!name.trim()} className={btn.primary}>
            {section ? "Save" : "Add section"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/** Asks before deleting a section: its tasks stay in the project, without a section. */
export function DeleteSectionDialog({ section, onClose }: { section: TaskSection | null; onClose: () => void }) {
  const { deleteSection, tasks } = useTasks();
  const shown = useRef(section);
  if (section) shown.current = section;
  const s = shown.current;
  const n = s ? tasks.filter((t) => t.sectionId === s.id && !t.completedAt).length : 0;
  return (
    <Dialog open={section != null} onClose={onClose} label="Delete section" width={420}>
      <div className="p-4">
        <p className="text-[14px] font-semibold">Delete “{s?.name}”?</p>
        <p className="mt-1 text-muted">
          {n > 0 ? `Its ${n} open task${n === 1 ? "" : "s"} stay in the project, without a section.` : "No open tasks are in it."} Tasks are never deleted with a section.
        </p>
        <div className="mt-4 flex justify-end gap-1.5">
          <button type="button" onClick={onClose} className={btn.outline}>
            Cancel
          </button>
          <button
            type="button"
            autoFocus
            className={btn.primary}
            onClick={() => {
              if (s) void deleteSection(s.id).then((ok) => ok && onClose());
            }}
          >
            Delete section
          </button>
        </div>
      </div>
    </Dialog>
  );
}

/** The ⋯ menu in a section's header: add a task, rename, move, delete. */
export function SectionMenu({
  section,
  first,
  last,
  onRename,
  onDelete,
  onMove,
  onAddTask,
}: {
  section: TaskSection;
  first: boolean;
  last: boolean;
  onRename: () => void;
  onDelete: () => void;
  onMove: (dir: -1 | 1) => void;
  onAddTask: () => void;
}) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const items: PickItem[] = [
    { id: "rename", label: "Rename", icon: <Icon name="sliders" size={13} className="text-faint" /> },
    ...(first ? [] : [{ id: "up", label: "Move up", icon: <Icon name="chevronUp" size={13} className="text-faint" /> }]),
    ...(last ? [] : [{ id: "down", label: "Move down", icon: <Icon name="chevronDown" size={13} className="text-faint" /> }]),
    { id: "delete", label: "Delete section", icon: <Icon name="trash" size={13} className="text-faint" /> },
  ];
  return (
    <>
      <button type="button" onClick={onAddTask} className={btn.icon} aria-label={`Add task to ${section.name}`} title="Add task to this section">
        <Icon name="plus" size={13} />
      </button>
      <button ref={anchor} type="button" onClick={() => setOpen(true)} className={btn.icon} aria-label={`Section options: ${section.name}`} aria-haspopup="menu">
        <Icon name="more" size={14} />
      </button>
      <Popover anchor={anchor} open={open} onClose={() => setOpen(false)} width={190} align="end">
        <PickList
          items={items}
          placeholder="Section…"
          autoFocus
          onPick={(id) => {
            setOpen(false);
            if (id === "rename") onRename();
            else if (id === "delete") onDelete();
            else onMove(id === "up" ? -1 : 1);
          }}
        />
      </Popover>
    </>
  );
}

const NONE = "__none";

/** The section a task sits in, among those of its project (the task panel). */
export function SectionPicker({ projectId, value, onChange }: { projectId: string; value: string | null; onChange: (id: string | null) => void }) {
  const { sections } = useTasks();
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const mine = sections.filter((s) => s.projectId === projectId);
  const current = mine.find((s) => s.id === value);
  const items: PickItem[] = [{ id: NONE, label: "No section", checked: value == null }, ...mine.map((s) => ({ id: s.id, label: s.name, checked: s.id === value }))];
  return (
    <>
      <button ref={anchor} type="button" onClick={() => setOpen(true)} className={btn.ghost} aria-label={`Section: ${current?.name ?? "none"}`}>
        {current?.name ?? "No section"}
      </button>
      <Popover anchor={anchor} open={open} onClose={() => setOpen(false)} width={220}>
        <PickList
          items={items}
          placeholder="Move to section…"
          onPick={(id) => {
            onChange(id === NONE ? null : id);
            setOpen(false);
          }}
        />
      </Popover>
    </>
  );
}

/** A position that puts a section above (-1) or below (1) its neighbour in `list` (sorted by position). */
export function movedPosition(list: TaskSection[], id: string, dir: -1 | 1): number | null {
  const i = list.findIndex((s) => s.id === id);
  const target = list[i + dir];
  if (i < 0 || !target) return null;
  const beyond = list[i + 2 * dir];
  return beyond ? (target.position + beyond.position) / 2 : target.position + dir;
}
