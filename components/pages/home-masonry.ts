"use client";

import { useLayoutEffect, useRef } from "react";

/** The space between panels, as in the grid's column gap (px). */
const GAP = 16;
const WIDE = "(min-width: 900px)";

/**
 * Pack Home's panels by their real height. A plain grid makes every row as tall
 * as its tallest panel, so a short panel beside a tall one leaves a hole under
 * it. Here the grid's rows are 1 px and each panel spans as many as its content
 * is tall; with dense placement the next panel moves up into the free space
 * beside a taller neighbour. A panel that grows or shrinks (a tab, a loaded
 * calendar) is measured again.
 *
 * Each grid item must wrap its content in one child element: that child is
 * measured, since the item itself is as tall as the rows it spans. Below 900 px
 * the grid is one column and the styles are taken off. `key` changes when the
 * set of panels does, so new ones are observed.
 */
export function useMasonry<T extends HTMLElement>(key: string) {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    const grid = ref.current;
    if (!grid || typeof ResizeObserver === "undefined") return;
    const mq = window.matchMedia(WIDE);
    const items = [...grid.children] as HTMLElement[];
    const layout = () => {
      const on = mq.matches;
      grid.style.gridAutoRows = on ? "1px" : "";
      grid.style.rowGap = on ? "0px" : "";
      // Every span includes the gap below its panel; the last row's is taken back.
      grid.style.marginBottom = on ? `-${GAP}px` : "";
      for (const el of items) {
        const inner = el.firstElementChild;
        el.style.gridRowEnd = on && inner ? `span ${Math.ceil(inner.getBoundingClientRect().height) + GAP}` : "";
      }
    };
    const observer = new ResizeObserver(layout);
    for (const el of items) if (el.firstElementChild) observer.observe(el.firstElementChild);
    mq.addEventListener("change", layout);
    layout();
    return () => {
      observer.disconnect();
      mq.removeEventListener("change", layout);
      for (const el of items) el.style.gridRowEnd = "";
    };
  }, [key]);
  return ref;
}
