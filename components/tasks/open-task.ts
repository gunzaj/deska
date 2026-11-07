"use client";

export const TASK_PARAM = "task";

/**
 * Open a task in the side panel by adding `?task=<id>` to the current URL,
 * like `?issue=N` for issues. Opening pushes a history entry, so Back closes
 * the panel; switching tasks while it is open replaces the entry.
 */
export function openTask(id: string) {
  const url = new URL(window.location.href);
  const already = url.searchParams.has(TASK_PARAM);
  url.searchParams.set(TASK_PARAM, id);
  url.searchParams.delete("issue");
  if (already) window.history.replaceState(null, "", url);
  else window.history.pushState(null, "", url);
}

export function closeTask() {
  const url = new URL(window.location.href);
  url.searchParams.delete(TASK_PARAM);
  window.history.replaceState(null, "", url);
}
