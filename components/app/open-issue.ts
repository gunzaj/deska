"use client";

import { useCallback, useSyncExternalStore } from "react";

const RECENT_KEY = "deska-recent";
export const PEEK_PARAM = "issue";

/** Issue numbers the viewer opened recently (newest first), for the palette. */
export function recentIssues(): number[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((n) => typeof n === "number").slice(0, 8) : [];
  } catch {
    return [];
  }
}

/** Record an issue as recently opened (the side panel, or a tab). */
export function rememberIssue(n: number) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([n, ...recentIssues().filter((x) => x !== n)].slice(0, 8)));
  } catch {
    /* storage unavailable */
  }
}

/**
 * Where the side panel came from: moving from issue to issue inside the panel
 * (a sub-issue, the parent trail, a duplicate) keeps the issues it showed
 * before, for its ← Back. Opening from anywhere else, or closing, forgets them.
 */
type Trail = { to: number; back: number[] };
let trail: Trail | null = null;
const trailListeners = new Set<() => void>();

function setTrail(t: Trail | null) {
  trail = t;
  for (const l of trailListeners) l();
}

/** The issue the panel's ← Back returns to while it shows `n`, if any. */
export function usePanelBack(n: number): number | null {
  const t = useSyncExternalStore(
    (l) => {
      trailListeners.add(l);
      return () => trailListeners.delete(l);
    },
    () => trail,
    () => null,
  );
  return t && t.to === n ? (t.back.at(-1) ?? null) : null;
}

/** ← Back in the side panel: show the issue it showed before. */
export function panelBack() {
  const t = trail;
  const prev = t?.back.at(-1);
  if (!t || prev == null) return;
  setTrail(t.back.length > 1 ? { to: prev, back: t.back.slice(0, -1) } : null);
  const url = new URL(window.location.href);
  url.searchParams.set(PEEK_PARAM, String(prev));
  window.history.replaceState(null, "", url);
}

/** Whether the click (or key) that is opening an issue came from inside the side panel. */
function fromPanel(): boolean {
  const ev = typeof window !== "undefined" ? (window.event as Event | undefined) : undefined;
  const src = ev?.target instanceof Element ? ev.target : document.activeElement;
  return !!src?.closest?.("[data-side-panel]");
}

export function peekedIssue(): number | null {
  const v = Number(new URL(window.location.href).searchParams.get(PEEK_PARAM));
  return Number.isInteger(v) && v > 0 ? v : null;
}

/**
 * Open an issue in the side panel by adding `?issue=N` to the current URL.
 * Opening pushes a history entry (Back closes the panel); switching between
 * issues while the panel is open replaces it. The same on a full issue page:
 * the other issue opens in the panel over it, so the page stays in view
 * (SPEC §4.2 [Tabs]).
 */
export function useOpenIssue() {
  return useCallback(
    (n: number) => {
      rememberIssue(n);
      const cur = peekedIssue();
      if (cur != null && cur !== n && fromPanel()) setTrail({ to: n, back: [...(trail?.to === cur ? trail.back : []), cur].slice(-20) });
      else if (cur !== n) setTrail(null);
      const url = new URL(window.location.href);
      const already = url.searchParams.has(PEEK_PARAM);
      url.searchParams.set(PEEK_PARAM, String(n));
      // One side panel at a time: opening an issue replaces an open task.
      url.searchParams.delete("task");
      if (already) window.history.replaceState(null, "", url);
      else window.history.pushState(null, "", url);
    },
    [],
  );
}

export function closePeek() {
  setTrail(null);
  const url = new URL(window.location.href);
  url.searchParams.delete(PEEK_PARAM);
  window.history.replaceState(null, "", url);
}
