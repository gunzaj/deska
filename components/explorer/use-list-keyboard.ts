"use client";

import { useEffect, useRef, type RefObject } from "react";
import { keyboardBusy } from "@/lib/client/keyboard";
import { ISSUE_LIST_KEYS } from "@/lib/client/shortcuts";

/**
 * The keyboard of a list explorer (v5 4.6): `/` focuses the search box, j/k
 * and the arrows move the focused row (clamped, from the first row when
 * nothing is focused), and everything else goes to `onKey`. Nothing fires
 * while a text field has focus.
 */
export function useListKeyboard<T extends { nodeId: string }>({
  order,
  focusedId,
  setFocusedId,
  searchRef,
  onMoved,
  onChord,
  onKey,
}: {
  /** The rows in the order they are shown. */
  order: readonly T[];
  focusedId: string | null;
  setFocusedId: (nodeId: string | null) => void;
  searchRef: RefObject<HTMLInputElement | null>;
  /** After the focus moved to `next`: follow it in a side panel, scroll it into view. */
  onMoved?: (next: T) => void;
  /** Keys with ⌘/Ctrl/Alt (⌘A), before the modifier bail-out. Return true when handled. */
  onChord?: (e: KeyboardEvent) => boolean;
  /** Any other key outside a text field; `index` is the focused row's position or -1. */
  onKey?: (e: KeyboardEvent, index: number) => void;
}) {
  const latest = useRef({ order, focusedId, setFocusedId, searchRef, onMoved, onChord, onKey });
  latest.current = { order, focusedId, setFocusedId, searchRef, onMoved, onChord, onKey };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const { order, focusedId, setFocusedId, searchRef, onMoved, onChord, onKey } = latest.current;
      if (onChord?.(e)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "/" && !keyboardBusy(e)) {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (keyboardBusy(e)) return;
      const idx = focusedId ? order.findIndex((r) => r.nodeId === focusedId) : -1;
      const action = ISSUE_LIST_KEYS[e.key];
      if (action === "next" || action === "prev") {
        e.preventDefault();
        const next = order[Math.max(0, Math.min(order.length - 1, idx + (action === "next" ? 1 : idx < 0 ? 1 : -1)))];
        if (!next) return;
        setFocusedId(next.nodeId);
        onMoved?.(next);
        return;
      }
      onKey?.(e, idx);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
}
