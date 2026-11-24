"use client";

// Customize Home (HOME-SPEC §5): hide and reorder its panels. Same pattern and
// dialog as Customize sidebar; the layout lives in prefs (`home`).
import { useEffect, useState } from "react";
import { resolveHome, type HomePanel } from "@/lib/tasks/model";
import { Icon } from "../icons";
import { usePrefs } from "../tasks/notifications";
import { Dialog } from "../ui/dialog";

export const PANEL_LABELS: Record<HomePanel, string> = {
  work: "My work",
  sprint: "Current sprint",
  epics: "Epics in this sprint",
  attention: "Needs attention",
  changes: "What changed",
};

/** The viewer's Home panels in their order, with a save that persists to prefs. */
export function useHomeLayout() {
  const { prefs, setPrefs } = usePrefs();
  const panels = resolveHome(prefs.home);
  const save = (next: { id: HomePanel; hidden: boolean }[] | null) => setPrefs({ home: next && { order: next.map((p) => p.id), hidden: next.filter((p) => p.hidden).map((p) => p.id) } });
  return { panels, save };
}

/** `available`: the panels this install can show (tasks-only mode has only My work). Changes apply as you make them. */
export function CustomizeHomeDialog({ open, onClose, available }: { open: boolean; onClose: () => void; available: ReadonlySet<HomePanel> }) {
  const { panels, save } = useHomeLayout();
  const [rows, setRows] = useState(panels);
  useEffect(() => {
    if (open) setRows(panels);
    // Seed from prefs each time the dialog opens; edits go straight back to
    // prefs, so a later change to `panels` must not reset the rows mid-edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const apply = (next: typeof rows) => {
    setRows(next);
    void save(next);
  };
  const shown = rows.filter((r) => available.has(r.id));
  /** Swap with the neighbour on screen; panels this install can't show keep their stored place. */
  const move = (id: HomePanel, by: -1 | 1) => {
    const other = shown[shown.findIndex((r) => r.id === id) + by];
    if (!other) return;
    const next = [...rows];
    const i = next.findIndex((r) => r.id === id);
    const j = next.findIndex((r) => r.id === other.id);
    [next[i], next[j]] = [next[j]!, next[i]!];
    apply(next);
  };
  const toggle = (id: HomePanel) => apply(rows.map((r) => (r.id === id ? { ...r, hidden: !r.hidden } : r)));
  const reset = () => {
    setRows(resolveHome(null));
    void save(null);
  };

  return (
    <Dialog open={open} onClose={onClose} label="Customize Home" width={380}>
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 className="text-[14px] font-semibold">Customize Home</h2>
        <button type="button" onClick={onClose} aria-label="Close" className="grid size-6 place-items-center rounded-md text-faint hover:bg-hover hover:text-fg">
          <Icon name="x" size={14} />
        </button>
      </div>
      <ul className="px-2 py-2" aria-label="Home panels">
        {shown.map((r, i) => (
          <li key={r.id} className="flex h-8 items-center gap-2 rounded-md px-2 hover:bg-hover">
            <label className="flex min-w-0 flex-1 items-center gap-2 text-[13px]">
              <input type="checkbox" checked={!r.hidden} onChange={() => toggle(r.id)} aria-label={`Show ${PANEL_LABELS[r.id]}`} />
              <span className={`truncate ${r.hidden ? "text-faint" : "text-fg"}`}>{PANEL_LABELS[r.id]}</span>
            </label>
            <button
              type="button"
              onClick={() => move(r.id, -1)}
              disabled={i === 0}
              aria-label={`Move ${PANEL_LABELS[r.id]} up`}
              className="grid size-6 place-items-center rounded text-faint hover:bg-active hover:text-fg disabled:opacity-30 disabled:hover:bg-transparent"
            >
              <Icon name="chevronDown" size={13} className="rotate-180" />
            </button>
            <button
              type="button"
              onClick={() => move(r.id, 1)}
              disabled={i === shown.length - 1}
              aria-label={`Move ${PANEL_LABELS[r.id]} down`}
              className="grid size-6 place-items-center rounded text-faint hover:bg-active hover:text-fg disabled:opacity-30 disabled:hover:bg-transparent"
            >
              <Icon name="chevronDown" size={13} />
            </button>
          </li>
        ))}
      </ul>
      <div className="flex items-center justify-between border-t border-line px-4 py-2.5 text-[12px] text-faint">
        <span>The tiles always show.</span>
        <button type="button" onClick={reset} className="rounded px-1.5 py-0.5 text-muted hover:bg-hover hover:text-fg">
          Reset
        </button>
      </div>
    </Dialog>
  );
}
