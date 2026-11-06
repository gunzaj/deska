"use client";

// Side-panel focus (IMPROVEMENTS U2): moving focus into a panel when it
// opens and back to what opened it when it closes. Swapping the item shown
// (j/k) keeps focus where it is.
import { useEffect, useRef, type RefObject } from "react";

export function usePanelFocus(ref: RefObject<HTMLElement | null>, open: boolean, fallback?: () => string | null) {
  const fallbackRef = useRef(fallback);
  fallbackRef.current = fallback;
  useEffect(() => {
    if (!open) return;
    const active = document.activeElement;
    const opener = active instanceof HTMLElement && active !== document.body && !ref.current?.contains(active) ? active : null;
    const raf = requestAnimationFrame(() => {
      const panel = ref.current;
      if (!panel) return;
      const target = panel.querySelector<HTMLElement>("h1, h2") ?? panel;
      if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
      target.focus({ preventScroll: true });
    });
    return () => {
      cancelAnimationFrame(raf);
      const sel = fallbackRef.current?.();
      const back = opener?.isConnected ? opener : sel ? document.querySelector<HTMLElement>(sel) : null;
      back?.focus({ preventScroll: true });
    };
  }, [open, ref]);
}
