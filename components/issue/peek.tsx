"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";
import { usePanelFocus } from "../app/panel-focus";
import { closePeek, PEEK_PARAM } from "../app/open-issue";
import { IssueDetailView } from "./detail";

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
    >
      <IssueDetailView key={n} number={n} mode="peek" onClose={closePeek} />
    </aside>
  );
}
