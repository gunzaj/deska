"use client";

import { useCallback, useState } from "react";
import { isUnauthorized } from "@/lib/client/session";
import type { TaskView, TaskViewDraft } from "@/lib/tasks/views";
import type { View } from "@/lib/views/view";

/** The saved issue and task views and their writes. */
export function useViews(initial: View[], initialTaskViews: TaskView[] = []) {
  const [views, setViews] = useState(initial);
  const [taskViews, setTaskViews] = useState(initialTaskViews);

  // Network errors resolve to null/false like HTTP errors do: callers (the save
  // dialog's busy state among them) only handle a failed result, not a throw.
  const upsertView = useCallback(async (v: View) => {
    const res = await fetch("/api/views", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...v, kind: "tasks" }) }).catch(() => null);
    if (isUnauthorized(res) || !res?.ok) return null;
    const saved = (await res.json()) as View;
    setViews((prev) => {
      const i = prev.findIndex((x) => x.id === saved.id);
      if (i === -1) return [...prev, saved];
      const next = [...prev];
      next[i] = saved;
      return next;
    });
    return saved;
  }, []);

  const restoreView = useCallback(async (id: string) => {
    const res = await fetch("/api/views/restore", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) }).catch(() => null);
    if (isUnauthorized(res) || !res?.ok) return null;
    const back = (await res.json()) as View;
    setViews((prev) => (prev.some((v) => v.id === back.id) ? prev : [...prev, back]));
    return back;
  }, []);

  const removeView = useCallback(async (id: string) => {
    const res = await fetch(`/api/views?id=${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => null);
    if (isUnauthorized(res) || !res?.ok) return false;
    setViews((prev) => prev.filter((v) => v.id !== id));
    return true;
  }, []);

  const upsertTaskView = useCallback(async (v: TaskViewDraft) => {
    const res = await fetch("/api/views", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...v, kind: "tasks" }) }).catch(() => null);
    if (isUnauthorized(res) || !res?.ok) return null;
    const saved = (await res.json()) as TaskView;
    setTaskViews((prev) => {
      const i = prev.findIndex((x) => x.id === saved.id);
      if (i === -1) return [...prev, saved];
      const next = [...prev];
      next[i] = saved;
      return next;
    });
    return saved;
  }, []);

  const removeTaskView = useCallback(async (id: string) => {
    const res = await fetch(`/api/views?id=${encodeURIComponent(id)}&kind=tasks`, { method: "DELETE" }).catch(() => null);
    if (isUnauthorized(res) || !res?.ok) return false;
    setTaskViews((prev) => prev.filter((v) => v.id !== id));
    return true;
  }, []);

  return { views, upsertView, removeView, restoreView, taskViews, upsertTaskView, removeTaskView };
}
