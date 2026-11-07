"use client";

import { useEffect, useState } from "react";
import { resolveSidebar, type SidebarSection } from "@/lib/tasks/model";
import { Icon } from "../icons";
import { Dialog } from "../ui/dialog";
import { usePrefs } from "../tasks/notifications";

/** Fired by the ⌘K palette to open the dialog from anywhere. */
export const CUSTOMIZE_SIDEBAR_EVENT = "deska:customize-sidebar";

export const SECTION_LABELS: Record<SidebarSection, string> = {
  tasks: "Tasks",
  projects: "Projects",
  labels: "Labels",
  workspace: "Workspace",
  views: "Views",
  teams: "First dimension",
};

/** The viewer's sidebar sections in their order, with a save that persists to prefs. */
export function useSidebarLayout() {
  const { prefs, setPrefs } = usePrefs();
  const sections = resolveSidebar(prefs.sidebar);
  const save = (next: { id: SidebarSection; hidden: boolean }[] | null) =>
    setPrefs({ sidebar: next && { order: next.map((s) => s.id), hidden: next.filter((s) => s.hidden).map((s) => s.id) } });
  return { sections, save };
}

/** Show, hide and reorder sidebar sections. Changes apply as you make them. */
export function CustomizeSidebarDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { sections, save } = useSidebarLayout();
  const [rows, setRows] = useState(sections);
  useEffect(() => {
    if (open) setRows(sections);
    // Seed from prefs each time the dialog opens; edits go straight back to
    // prefs, so a later change to `sections` must not reset the rows mid-edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const apply = (next: typeof rows) => {
    setRows(next);
    void save(next);
  };
  const move = (i: number, by: -1 | 1) => {
    const j = i + by;
    if (j < 0 || j >= rows.length) return;
    const next = [...rows];
    next.splice(j, 0, ...next.splice(i, 1));
    apply(next);
  };
  const toggle = (i: number) => apply(rows.map((r, k) => (k === i ? { ...r, hidden: !r.hidden } : r)));
  const reset = () => {
    setRows(resolveSidebar(null));
    void save(null);
  };

  return (
    <Dialog open={open} onClose={onClose} label="Customize sidebar" width={380}>
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 className="text-[14px] font-semibold">Customize sidebar</h2>
        <button type="button" onClick={onClose} aria-label="Close" className="grid size-6 place-items-center rounded-md text-faint hover:bg-hover hover:text-fg">
          <Icon name="x" size={14} />
        </button>
      </div>
      <ul className="px-2 py-2" aria-label="Sidebar sections">
        {rows.map((r, i) => (
          <li key={r.id} className="flex h-8 items-center gap-2 rounded-md px-2 hover:bg-hover">
            <label className="flex min-w-0 flex-1 items-center gap-2 text-[13px]">
              <input type="checkbox" checked={!r.hidden} onChange={() => toggle(i)} aria-label={`Show ${SECTION_LABELS[r.id]}`} />
              <span className={`truncate ${r.hidden ? "text-faint" : "text-fg"}`}>{SECTION_LABELS[r.id]}</span>
            </label>
            <button
              type="button"
              onClick={() => move(i, -1)}
              disabled={i === 0}
              aria-label={`Move ${SECTION_LABELS[r.id]} up`}
              className="grid size-6 place-items-center rounded text-faint hover:bg-active hover:text-fg disabled:opacity-30 disabled:hover:bg-transparent"
            >
              <Icon name="chevronDown" size={13} className="rotate-180" />
            </button>
            <button
              type="button"
              onClick={() => move(i, 1)}
              disabled={i === rows.length - 1}
              aria-label={`Move ${SECTION_LABELS[r.id]} down`}
              className="grid size-6 place-items-center rounded text-faint hover:bg-active hover:text-fg disabled:opacity-30 disabled:hover:bg-transparent"
            >
              <Icon name="chevronDown" size={13} />
            </button>
          </li>
        ))}
      </ul>
      <div className="flex items-center justify-between border-t border-line px-4 py-2.5 text-[12px] text-faint">
        <span>Hidden pages stay reachable from ⌘K.</span>
        <button type="button" onClick={reset} className="rounded px-1.5 py-0.5 text-muted hover:bg-hover hover:text-fg">
          Reset
        </button>
      </div>
    </Dialog>
  );
}
