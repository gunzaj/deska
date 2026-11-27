"use client";

import { useCallback, useRef, useState } from "react";
import { isUnauthorized } from "@/lib/client/session";
import type { TaskView, TaskViewDraft } from "@/lib/tasks/views";
import type { ListPrefs, ListState } from "@/lib/views/list-prefs";
import type { View } from "@/lib/views/view";

/** The saved issue and task views, the built-in lists' defaults, and their writes. */
export function useViews(initial: View[], initialTaskViews: TaskView[] = [], initialListPrefs: ListPrefs = {}) {
  const [views, setViews] = useState(initial);
  const [taskViews, setTaskViews] = useState(initialTaskViews);
  const [listPrefs, setListPrefs] = useState<ListPrefs>(initialListPrefs);
  // The latest defaults, for a write's rollback.
  const listRef = useRef(listPrefs);
  listRef.current = listPrefs;
  /** Put one page's entry back as it was, leaving any other page saved meanwhile alone. */
  const restoreListPref = useCallback((key: string, was: ListState | undefined) => {
    setListPrefs((now) => {
      const next = { ...now };
      if (was) next[key] = was;
      else delete next[key];
      return next;
    });
  }, []);

  // Network errors resolve to null/false like HTTP errors do: callers (the save
  // dialog's busy state among them) only handle a failed result, not a throw.
  const upsertView = useCallback(async (v: View) => {
    const res = await fetch("/api/views", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(v) }).catch(() => null);
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

  /**
   * A built-in page's defaults: optimistic, and put back on a failed write so
   * the page does not show a default that will be gone on the next visit.
   */
  const saveListPref = useCallback(async (key: string, state: ListState) => {
    const was = Object.hasOwn(listRef.current, key) ? listRef.current[key] : undefined;
    setListPrefs((now) => ({ ...now, [key]: state }));
    const res = await fetch("/api/me/list-prefs", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ key, state }) }).catch(() => null);
    if (isUnauthorized(res) || !res?.ok) {
      restoreListPref(key, was);
      return false;
    }
    const body = (await res.json().catch(() => null)) as { lists?: ListPrefs } | null;
    if (body?.lists) setListPrefs(body.lists);
    return true;
  }, [restoreListPref]);

  /** Forget one page's defaults (or all, with no key). */
  const clearListPref = useCallback(async (key?: string) => {
    const before = listRef.current;
    if (key) restoreListPref(key, undefined);
    else setListPrefs({});
    const res = await fetch(`/api/me/list-prefs${key ? `?key=${encodeURIComponent(key)}` : ""}`, { method: "DELETE" }).catch(() => null);
    if (isUnauthorized(res) || !res?.ok) {
      if (key) restoreListPref(key, Object.hasOwn(before, key) ? before[key] : undefined);
      else setListPrefs(before);
      return false;
    }
    const body = (await res.json().catch(() => null)) as { lists?: ListPrefs } | null;
    if (body?.lists) setListPrefs(body.lists);
    return true;
  }, [restoreListPref]);

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

  return { views, upsertView, removeView, restoreView, taskViews, upsertTaskView, removeTaskView, listPrefs, saveListPref, clearListPref };
}
