"use client";

import { useSearchParams } from "next/navigation";
import { useEffect } from "react";

/** Query params of the side panels (issue, task, PR). One is open at a time. */
const PANEL_PARAMS = ["issue", "task", "pr"] as const;

/** Elements the outside-click rule treats specially. */
const SIDE_PANEL = "data-side-panel";
/** A list row or card that opens an item when clicked. */
const PEEK_ROW = "data-peek-row";
/** The title inside such a row: the only part that opens an item while a panel is open. */
const PEEK_TITLE = "data-peek-title";

const CONTROL = 'button, a, input, select, textarea, label, [role="checkbox"]';

function closePanels() {
  const url = new URL(window.location.href);
  for (const p of PANEL_PARAMS) url.searchParams.delete(p);
  window.history.replaceState(null, "", url);
}

/**
 * While a side panel is open, a click outside it closes it. A click on an
 * item's title still opens that item in the panel, and buttons, links and
 * checkboxes do their own thing and leave the panel open. Any other click on
 * a row only closes the panel, so it doesn't swap the item shown.
 */
export function PanelDismiss() {
  const params = useSearchParams();
  const open = PANEL_PARAMS.some((p) => params.has(p));

  useEffect(() => {
    if (!open) return;
    document.body.setAttribute("data-panel-open", "");
    // Decided on pointerdown: by click time a popover may already have closed,
    // and a text selection dragged out of the panel must not count.
    let dismiss = false;
    const onDown = (e: PointerEvent) => {
      const el = e.target as Element | null;
      dismiss = Boolean(el?.closest) && !el!.closest(`[${SIDE_PANEL}]`) && !document.querySelector('[role="dialog"]') && e.button === 0;
    };
    const onClick = (e: MouseEvent) => {
      if (!dismiss) return;
      dismiss = false;
      const el = e.target as Element;
      if (el.closest(`[${PEEK_TITLE}]`)) return;
      const row = el.closest(`[${PEEK_ROW}]`);
      const control = el.closest(CONTROL);
      // Checkboxes, buttons and links do their own thing; the panel stays.
      if (control && !(row && (control === row || control.contains(row)))) return;
      if (row) {
        e.preventDefault();
        e.stopPropagation();
      }
      closePanels();
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("click", onClick, true);
    return () => {
      document.body.removeAttribute("data-panel-open");
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("click", onClick, true);
    };
  }, [open]);

  return null;
}
