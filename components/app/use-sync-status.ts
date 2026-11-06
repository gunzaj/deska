"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePoll } from "@/lib/client/poll";
import { isUnauthorized } from "@/lib/client/session";

export type SyncState = {
  lastSync: string | null;
  rateLimited: boolean;
  rateLimitedUntil: string | null;
  /** No sync cursor yet: run `pnpm sync:full --live --db` (S2). */
  needsInitialImport: boolean;
  /** S3: the last cycle start, the last (redacted) error, failures in a row. */
  lastAttemptAt: string | null;
  lastError: string | null;
  consecutiveFailures: number;
  busy: boolean;
  error: string | null;
  /** A skipped "Sync now" (S1): "Sync already running" / "Synced just now". */
  notice: string | null;
};

/**
 * The sync chip's state: `/api/sync-status` polled while the tab is visible,
 * and "Sync now". `refresh` reloads the issue data after a manual sync.
 */
export function useSyncStatus(refresh: () => Promise<void>) {
  const [sync, setSync] = useState<SyncState>({
    lastSync: null,
    rateLimited: false,
    rateLimitedUntil: null,
    needsInitialImport: false,
    lastAttemptAt: null,
    lastError: null,
    consecutiveFailures: 0,
    busy: false,
    error: null,
    notice: null,
  });
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Status is a separate endpoint from /api/data: its own sequence.
  const statusSeq = useRef(0);

  const loadStatus = useCallback(async () => {
    const seq = ++statusSeq.current;
    try {
      const res = await fetch("/api/sync-status", { cache: "no-store" });
      if (isUnauthorized(res) || !res.ok) return;
      const s = await res.json();
      if (seq !== statusSeq.current) return;
      const next = {
        lastSync: s.lastSync,
        rateLimited: s.rateLimited,
        rateLimitedUntil: s.rateLimitedUntil,
        needsInitialImport: s.needsInitialImport === true,
        lastAttemptAt: s.lastAttemptAt ?? null,
        lastError: s.lastError ?? null,
        consecutiveFailures: Number(s.consecutiveFailures) || 0,
      };
      // The poll runs every 30 s: keep the same state object when nothing
      // moved, so nothing that reads it re-renders (v5 3.2).
      setSync((prev) => ((Object.keys(next) as (keyof typeof next)[]).every((k) => prev[k] === next[k]) ? prev : { ...prev, ...next }));
    } catch {
      /* offline */
    }
  }, []);

  const syncNow = useCallback(async () => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    setSync((s) => ({ ...s, busy: true, error: null, notice: null }));
    let error: string | null = null;
    let notice: string | null = null;
    try {
      const res = await fetch("/api/sync-now", { method: "POST" });
      if (isUnauthorized(res)) return setSync((s) => ({ ...s, busy: false }));
      const body = await res.json().catch(() => null);
      // The chip already says "Initial import needed" (from sync-status).
      if (res.status === 503 && body?.error === "needs initial import") error = null;
      else if (!res.ok) error = body?.error ?? `Sync failed (HTTP ${res.status})`;
      // Another cycle is running, or one just ran: not an error.
      else if (body?.skipped === "sync-in-progress") notice = "Sync already running";
      else if (body?.skipped === "too-soon") notice = "Synced just now";
    } catch {
      error = "Sync request failed — check your connection.";
    }
    await Promise.all([refresh(), loadStatus()]);
    setSync((s) => ({ ...s, busy: false, error, notice }));
    if (notice) noticeTimer.current = setTimeout(() => setSync((s) => ({ ...s, notice: null })), 5_000);
  }, [refresh, loadStatus]);
  useEffect(
    () => () => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    },
    [],
  );

  usePoll(loadStatus, { every: 30_000 });

  return { sync, syncNow };
}
