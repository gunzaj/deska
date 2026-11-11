"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { usePanelFocus } from "../app/panel-focus";
import { useNarrow } from "../app/use-narrow";
import { closePeek, PEEK_PARAM } from "../app/open-issue";
import { IssueDetailView } from "./detail";

/** Keep a dragged panel wide enough to read and narrow enough to leave the list. */
function clampWidth(w: number) {
  return Math.max(360, Math.min(w, window.innerWidth - 260));
}

/**
 * Linear-style side panel over the right of the content. The list behind it
 * stays interactive, so j/k and clicks swap the issue shown here.
 */
export function IssuePeek() {
  const params = useSearchParams();
  const n = Number(params.get(PEEK_PARAM));
  const open = Number.isInteger(n) && n > 0;
  const panel = useRef<HTMLElement>(null);
  const shown = useRef(n);
  shown.current = n;
  // Resize by dragging the panel's left edge (improvement 2); the width stays
  // for this launch, and a narrow window keeps the full-screen panel.
  const narrow = useNarrow();
  const [width, setWidth] = useState<number | null>(null);
  const drag = useRef<{ x: number; width: number } | null>(null);
  const resizeTo = (w: number) => setWidth(clampWidth(w));
  const startResize = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || narrow) return;
    e.preventDefault();
    drag.current = { x: e.clientX, width: panel.current?.getBoundingClientRect().width ?? 736 };
    e.currentTarget.setPointerCapture(e.pointerId);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };
  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      setWidth(clampWidth(d.width + d.x - e.clientX));
    };
    const end = () => {
      if (!drag.current) return;
      drag.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      end();
    };
  }, []);
  // Focus to the heading on open; back to the row (or the row of the issue
  // last shown, after j/k) on close.
  usePanelFocus(panel, open, () => `[data-issue="${shown.current}"]`);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
      if (document.querySelector('[role="dialog"]')) return;
      closePeek();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) return null;
  return (
    <aside
      ref={panel}
      role="complementary"
      data-side-panel
      aria-label={`Issue #${n}`}
      className="anim-slide fixed inset-0 z-30 bg-surface md:inset-y-3 md:left-auto md:right-3 md:w-[min(46rem,calc(100vw-260px))] md:rounded-xl md:border md:border-line md:shadow-modal"
      style={!narrow && width ? { width, maxWidth: "calc(100vw - 260px)" } : undefined}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize issue panel"
        aria-valuemin={360}
        aria-valuemax={typeof window === "undefined" ? undefined : window.innerWidth - 260}
        aria-valuenow={width ?? undefined}
        tabIndex={0}
        data-panel-resize
        onPointerDown={startResize}
        onKeyDown={(e) => {
          if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
          e.preventDefault();
          const current = width ?? panel.current?.getBoundingClientRect().width ?? 736;
          resizeTo(current + (e.key === "ArrowLeft" ? 24 : -24));
        }}
        className="group absolute inset-y-0 left-0 z-10 hidden w-1.5 cursor-col-resize touch-none items-center justify-center md:flex"
      >
        <span aria-hidden className="h-10 w-px rounded-full bg-line-field transition-colors group-hover:bg-brand-border group-focus-visible:bg-brand-border" />
      </div>
      <IssueDetailView key={n} number={n} mode="peek" onClose={closePeek} />
    </aside>
  );
}
