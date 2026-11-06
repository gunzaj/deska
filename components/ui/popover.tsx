"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../icons";

/**
 * Open popovers and dialogs, innermost last. Escape closes only the top one,
 * whichever element has focus (a popover's trigger stays focused inside a dialog).
 */
const layers: object[] = [];

/** Registers an open layer; `isTop()` says whether it should handle Escape. */
export function useLayer(open: boolean): () => boolean {
  const me = useRef({}).current;
  useEffect(() => {
    if (!open) return;
    layers.push(me);
    return () => {
      const i = layers.lastIndexOf(me);
      if (i >= 0) layers.splice(i, 1);
    };
  }, [open, me]);
  return useCallback(() => layers[layers.length - 1] === me, [me]);
}

/**
 * Floating panel anchored to a trigger, rendered in a portal so overflow on
 * scroll containers never clips it. Flips above / shifts left near edges.
 */
export function Popover({
  anchor,
  open,
  onClose,
  children,
  align = "start",
  width,
}: {
  anchor: RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  align?: "start" | "end";
  width?: number;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; maxH: number } | null>(null);
  const isTop = useLayer(open);
  // Callers pass inline handlers; a ref keeps the listeners below from re-subscribing every render.
  const close = useRef(onClose);
  close.current = onClose;

  const place = useCallback(() => {
    const a = anchor.current?.getBoundingClientRect();
    const p = panel.current;
    if (!a || !p) return;
    const w = p.offsetWidth;
    const h = p.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = align === "end" ? a.right - w : a.left;
    left = Math.max(8, Math.min(left, vw - w - 8));
    const below = vh - a.bottom - 12;
    const above = a.top - 12;
    const flip = h > below && above > below;
    const maxH = Math.max(160, flip ? above : below);
    const top = flip ? Math.max(8, a.top - 4 - Math.min(h, maxH)) : a.bottom + 4;
    setPos({ top, left, maxH });
  }, [anchor, align]);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panel.current?.contains(t) || anchor.current?.contains(t)) return;
      close.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isTop()) {
        e.stopPropagation();
        close.current();
        anchor.current?.focus();
      }
    };
    const ro = new ResizeObserver(place);
    if (panel.current) ro.observe(panel.current);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", place);
    return () => {
      ro.disconnect();
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", place);
    };
  }, [open, anchor, place, isTop]);

  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div
      ref={panel}
      role="dialog"
      className="anim-pop fixed z-50 flex flex-col overflow-hidden rounded-xl border border-line bg-popover shadow-pop"
      style={{
        top: pos?.top ?? -9999,
        left: pos?.left ?? -9999,
        width,
        maxHeight: pos?.maxH,
        visibility: pos ? "visible" : "hidden",
      }}
    >
      {children}
    </div>,
    document.body,
  );
}

export type PickItem = {
  id: string;
  label: string;
  icon?: ReactNode;
  hint?: ReactNode;
  checked?: boolean;
  section?: string;
};

/**
 * Searchable list used by filter pickers, the display menu and quick menus.
 * Arrow keys move, Enter/Space toggles, typing filters. With `onSearch` the
 * caller filters `items` itself (e.g. a ranked search) and gets the query.
 */
export function PickList({
  items,
  onPick,
  multi = false,
  placeholder = "Search…",
  autoFocus = true,
  emptyText = "No matches",
  footer,
  onSearch,
}: {
  items: PickItem[];
  onPick: (id: string) => void;
  multi?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
  emptyText?: string;
  footer?: ReactNode;
  onSearch?: (q: string) => void;
}) {
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const needle = q.trim().toLowerCase();
  const shown = needle && !onSearch ? items.filter((i) => i.label.toLowerCase().includes(needle) || i.id.toLowerCase() === needle) : items;
  const capped = shown.slice(0, 300);

  useEffect(() => setActive(0), [needle]);
  // Also runs on mount, so a reopened picker doesn't keep the last query.
  const onSearchRef = useRef(onSearch);
  useEffect(() => {
    onSearchRef.current = onSearch;
  });
  useEffect(() => onSearchRef.current?.(q), [q]);
  useEffect(() => {
    list.current?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-line px-3">
        <Icon name="search" size={13} className="text-faint" />
        <input
          autoFocus={autoFocus}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={placeholder}
          className="h-9 min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-faint"
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, capped.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              const it = capped[Math.min(active, capped.length - 1)];
              if (it) onPick(it.id);
            }
          }}
        />
      </div>
      <div ref={list} role="listbox" aria-multiselectable={multi} className="min-h-0 flex-1 overflow-y-auto p-1">
        {capped.length === 0 && <p className="px-2 py-3 text-center text-faint">{emptyText}</p>}
        {capped.map((it, idx) => {
          const prev = capped[idx - 1];
          return (
            <div key={it.id}>
              {it.section && it.section !== prev?.section && (
                <p className="px-2 pb-1 pt-2 text-[11px] font-semibold text-faint">{it.section}</p>
              )}
              <button
                type="button"
                role="option"
                aria-selected={it.checked ?? false}
                data-idx={idx}
                onMouseEnter={() => setActive(idx)}
                onClick={() => onPick(it.id)}
                className={`flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] ${idx === active ? "bg-hover" : ""}`}
              >
                {multi && (
                  <span
                    className={`grid size-3.5 shrink-0 place-items-center rounded border ${
                      it.checked ? "border-brand-border bg-brand text-brand-on" : "border-line-field"
                    }`}
                  >
                    {it.checked && <Icon name="check" size={10} strokeWidth={3} />}
                  </span>
                )}
                {it.icon && <span className="grid w-4 shrink-0 place-items-center">{it.icon}</span>}
                <span className="min-w-0 flex-1 truncate">{it.label}</span>
                {it.hint != null && <span className="shrink-0 text-[11.5px] tabular-nums text-faint">{it.hint}</span>}
                {!multi && it.checked && <Icon name="check" size={13} className="text-brand-text" />}
              </button>
            </div>
          );
        })}
        {shown.length > capped.length && <p className="px-2 py-1.5 text-[11.5px] text-faint">Keep typing to narrow {shown.length - capped.length} more…</p>}
      </div>
      {footer && <div className="border-t border-line p-1">{footer}</div>}
    </div>
  );
}

export const btn = {
  ghost:
    "inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[12.5px] font-medium text-muted transition-colors hover:bg-hover hover:text-fg disabled:opacity-50",
  outline:
    "inline-flex h-7 items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 text-[12.5px] font-medium text-fg shadow-raised transition-colors hover:bg-hover disabled:opacity-50",
  primary:
    "inline-flex h-7 items-center gap-1.5 rounded-md bg-brand px-2.5 text-[12.5px] font-semibold text-brand-on transition-colors hover:bg-brand-hover disabled:opacity-50",
  icon: "grid size-7 place-items-center rounded-md text-muted transition-colors hover:bg-hover hover:text-fg",
};
