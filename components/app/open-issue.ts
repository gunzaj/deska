"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback } from "react";

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

function remember(n: number) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([n, ...recentIssues().filter((x) => x !== n)].slice(0, 8)));
  } catch {
    /* storage unavailable */
  }
}

export function peekedIssue(): number | null {
  const v = Number(new URL(window.location.href).searchParams.get(PEEK_PARAM));
  return Number.isInteger(v) && v > 0 ? v : null;
}

/**
 * Open an issue in the side panel by adding `?issue=N` to the current URL.
 * Opening pushes a history entry (Back closes the panel); switching between
 * issues while the panel is open replaces it. On the full issue page it
 * navigates to the other issue's page instead.
 */
export function useOpenIssue() {
  const router = useRouter();
  const path = usePathname();
  return useCallback(
    (n: number) => {
      remember(n);
      if (path.startsWith("/issues/")) {
        router.push(`/issues/${n}`);
        return;
      }
      const url = new URL(window.location.href);
      const already = url.searchParams.has(PEEK_PARAM);
      url.searchParams.set(PEEK_PARAM, String(n));
      // One side panel at a time: opening an issue replaces an open task.
      url.searchParams.delete("task");
      if (already) window.history.replaceState(null, "", url);
      else window.history.pushState(null, "", url);
    },
    [router, path],
  );
}

export function closePeek() {
  const url = new URL(window.location.href);
  url.searchParams.delete(PEEK_PARAM);
  window.history.replaceState(null, "", url);
}
