"use client";

// Customize Home (HOME-SPEC §5): in-place editing of its panels. A panel is
// moved by dragging its handle (or with the arrow buttons), given one of four
// widths, or hidden; hidden panels wait below the grid until shown again. The
// layout lives in prefs (`home`).
import type { DragEvent } from "react";
import { HOME_SIZES, resolveHome, type HomePanel, type HomeRow, type HomeSize } from "@/lib/tasks/model";
import { Icon } from "../icons";
import { usePrefs } from "../tasks/notifications";

export const PANEL_LABELS: Record<HomePanel, string> = {
  work: "My work",
  sprint: "Current sprint",
  epics: "Epics in this sprint",
  calendar: "Calendar",
  attention: "Needs attention",
  changes: "What changed",
};

/** What the width menu offers; on screens under 900 px every panel is full width anyway. */
export const SIZE_LABELS: Record<HomeSize, string> = {
  third: "Narrow · 1/3",
  half: "Half · 1/2",
  wide: "Wide · 2/3",
  full: "Full width",
};

/** The viewer's Home panels with their size, and a save that persists all of it to prefs. */
export function useHomeLayout() {
  const { prefs, setPrefs } = usePrefs();
  const panels = resolveHome(prefs.home);
  const save = (next: HomeRow[] | null) =>
    setPrefs({
      home: next && {
        order: next.map((p) => p.id),
        hidden: next.filter((p) => p.hidden).map((p) => p.id),
        sizes: Object.fromEntries(next.map((p) => [p.id, p.size])) as Record<HomePanel, HomeSize>,
      },
    });
  return { panels, save };
}

const tool = "grid size-6 place-items-center rounded text-faint hover:bg-active hover:text-fg disabled:opacity-30 disabled:hover:bg-transparent";

/** The controls above a panel while Home is being customized. */
export function HomeEditBar({
  id,
  size,
  first,
  last,
  dragging,
  onMove,
  onSize,
  onHide,
  onDragStart,
  onDragEnd,
}: {
  id: HomePanel;
  size: HomeSize;
  first: boolean;
  last: boolean;
  dragging: boolean;
  onMove: (by: -1 | 1) => void;
  onSize: (size: HomeSize) => void;
  onHide: () => void;
  onDragStart: (e: DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
}) {
  const label = PANEL_LABELS[id];
  return (
    <div
      data-home-edit={id}
      className={`mb-1 flex min-w-0 flex-wrap items-center gap-1 rounded-lg border border-line bg-surface px-1.5 py-1 shadow-raised ${dragging ? "ring-1 ring-brand-border" : ""}`}
    >
      <span
        aria-hidden
        title="Drag to move"
        draggable
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        data-home-drag={id}
        className="grid size-6 cursor-grab place-items-center text-faint active:cursor-grabbing"
      >
        <Icon name="grip" size={14} />
      </span>
      <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-muted">{label}</span>
      <button type="button" onClick={() => onMove(-1)} disabled={first} aria-label={`Move ${label} up`} className={tool}>
        <Icon name="chevronUp" size={13} />
      </button>
      <button type="button" onClick={() => onMove(1)} disabled={last} aria-label={`Move ${label} down`} className={tool}>
        <Icon name="chevronDown" size={13} />
      </button>
      <select
        value={size}
        onChange={(e) => onSize(e.target.value as HomeSize)}
        aria-label={`Size of ${label}`}
        title="Width"
        className="h-6 rounded-md border border-line bg-surface px-1 text-[11.5px] text-muted"
      >
        {HOME_SIZES.map((s) => (
          <option key={s} value={s}>
            {SIZE_LABELS[s]}
          </option>
        ))}
      </select>
      <button type="button" onClick={onHide} aria-label={`Hide ${label}`} title="Hide" className={tool}>
        <Icon name="eye" size={14} />
      </button>
    </div>
  );
}

/** Panels that are hidden but can come back; shown below the grid while customizing. */
export function HiddenPanels({ rows, onShow }: { rows: HomeRow[]; onShow: (id: HomePanel) => void }) {
  if (rows.length === 0) return null;
  return (
    <div data-home-hidden className="flex flex-wrap items-center gap-1.5 rounded-xl border border-dashed border-line px-3 py-2">
      <span className="text-[12px] text-faint">Hidden</span>
      {rows.map((r) => (
        <button
          key={r.id}
          type="button"
          onClick={() => onShow(r.id)}
          aria-label={`Show ${PANEL_LABELS[r.id]}`}
          className="flex h-7 items-center gap-1.5 rounded-md border border-line bg-surface px-2 text-[12px] text-muted hover:bg-hover hover:text-fg"
        >
          <Icon name="plus" size={12} />
          {PANEL_LABELS[r.id]}
        </button>
      ))}
    </div>
  );
}
