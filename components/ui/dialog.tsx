"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useLayer } from "./popover";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

/** Visible, focusable elements inside `root`, in tab order. */
function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement);
}

/**
 * Centered modal with backdrop; Esc and backdrop click close it. Focus moves
 * in on open, Tab is trapped inside, and focus returns on close (U2).
 */
export function Dialog({ open, onClose, children, width = 440, label }: { open: boolean; onClose: () => void; children: ReactNode; width?: number; label: string }) {
  const panel = useRef<HTMLDivElement>(null);
  const isTop = useLayer(open);
  // Callers pass inline handlers. Depending on them would re-run the effect on
  // every parent render, and its cleanup would pull focus out of the open dialog.
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    // Focus moves in (U2): the first focusable control, else the dialog.
    const raf = requestAnimationFrame(() => {
      const p = panel.current;
      if (!p || p.contains(document.activeElement)) return;
      (focusables(p)[0] ?? p).focus();
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Tab" && isTop()) {
        // Tab and Shift+Tab stay inside the dialog.
        const p = panel.current;
        if (!p) return;
        const list = focusables(p);
        if (!list.length) {
          e.preventDefault();
          p.focus();
          return;
        }
        const first = list[0]!;
        const last = list[list.length - 1]!;
        const at = document.activeElement;
        if (e.shiftKey && (at === first || !p.contains(at))) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && (at === last || !p.contains(at))) {
          e.preventDefault();
          first.focus();
        }
        return;
      }
      if (e.key === "Escape") {
        // A popover opened from inside the dialog closes itself first.
        if (!isTop()) return;
        const other = (e.target as HTMLElement | null)?.closest?.('[role="dialog"]');
        if (other && other !== panel.current) return;
        // So does an open combobox (e.g. quick-add suggestions); the command
        // palette marks itself as one that Escape must close.
        const target = e.target as HTMLElement | null;
        if (target?.getAttribute?.("aria-expanded") === "true" && !target.hasAttribute("data-dialog-escape")) return;
        e.stopPropagation();
        close.current();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKey, true);
      prev?.focus?.();
    };
  }, [open, isTop]);
  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[12vh]">
      <button type="button" aria-label="Close" tabIndex={-1} onClick={onClose} className="anim-fade absolute inset-0 cursor-default bg-underlay" />
      <div ref={panel} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1} className="anim-pop relative max-h-[calc(100dvh-12vh-1rem)] w-full overflow-y-auto overscroll-contain rounded-2xl border border-line bg-popover shadow-modal outline-none" style={{ maxWidth: width }}>
        {children}
      </div>
    </div>,
    document.body,
  );
}
