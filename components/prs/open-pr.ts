"use client";

export const PR_PARAM = "pr";

/** Open a PR in the side panel (`?pr=N`); one side panel at a time. */
export function openPr(n: number) {
  const url = new URL(window.location.href);
  const already = url.searchParams.has(PR_PARAM);
  url.searchParams.set(PR_PARAM, String(n));
  url.searchParams.delete("issue");
  url.searchParams.delete("task");
  if (already) window.history.replaceState(null, "", url);
  else window.history.pushState(null, "", url);
}

export function closePr() {
  const url = new URL(window.location.href);
  url.searchParams.delete(PR_PARAM);
  window.history.replaceState(null, "", url);
}
