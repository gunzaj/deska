"use client";

// The viewer's watchlist (IMPROVEMENTS F6): loaded once, changed optimistically,
// with what changed on the watched items since they last looked. Kept in Deska
// only, so it works with writes off.
import { fetchPreloaded } from "@/lib/client/preload";
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { isUnauthorized } from "@/lib/client/session";
import { usePoll } from "@/lib/client/poll";
import type { FieldChange } from "@/lib/sync/changes";
import { useToast } from "../ui/toast";

export type WatchKind = "issue" | "view";
export type WatchItem = { kind: WatchKind; targetId: string; lastSeenAt: string };
export const watchKey = (kind: WatchKind, id: string) => `${kind}:${id}`;

type Ctx = {
  watches: WatchItem[];
  /** Per watch key: what changed since the last look. */
  changes: Record<string, FieldChange[]>;
  loaded: boolean;
  isWatching: (kind: WatchKind, id: string) => boolean;
  toggle: (kind: WatchKind, id: string) => Promise<void>;
  markSeen: (kind: WatchKind, id: string) => Promise<void>;
  refresh: () => Promise<void>;
  /** Watches with something new (the sidebar count). */
  unseen: number;
};

const Context = createContext<Ctx | null>(null);
const EMPTY: Ctx = { watches: [], changes: {}, loaded: true, isWatching: () => false, toggle: async () => {}, markSeen: async () => {}, refresh: async () => {}, unseen: 0 };
const REFRESH_MS = 120_000;

export function useWatchlist(): Ctx {
  return useContext(Context) ?? EMPTY;
}

const json = { "content-type": "application/json" };

export function WatchProvider({ children }: { children: ReactNode }) {
  const { toast } = useToast();
  const [watches, setWatches] = useState<WatchItem[]>([]);
  const [changes, setChanges] = useState<Record<string, FieldChange[]>>({});
  const [loaded, setLoaded] = useState(false);
  // The latest issues and views, for refreshes that outlive a render.
  // Bumped by every local change, so a refresh that started before it can't overwrite it.
  const edits = useRef(0);
  // Only the newest refresh may apply its result (the mount refresh and a poll
  // can otherwise land out of order).
  const seq = useRef(0);
  // (The browser no longer works out what a watched view covers: the server ignores
  // that set and computes it itself, v4 1.2; v5 3.10.)
  const latest = useRef({ watches });
  latest.current = { watches };
  // The latest changes, for the mark-seen rollback that outlives a render.
  const changesRef = useRef(changes);
  changesRef.current = changes;

  const loadChanges = useCallback(
    async (list: WatchItem[]) => {
      if (!list.length) {
        setChanges({});
        return;
      }
      const res = await fetch("/api/watches/changes", { method: "POST", headers: json, body: JSON.stringify({ items: list.map((w) => ({ kind: w.kind, targetId: w.targetId })) }) }).catch(() => null);
      if (isUnauthorized(res) || !res?.ok) return;
      setChanges(((await res.json()) as { changes: Record<string, FieldChange[]> }).changes);
    },
    [],
  );

  const refresh = useCallback(async () => {
    const started = edits.current;
    const my = ++seq.current;
    const res = await fetchPreloaded("/api/watches", { cache: "no-store" }).catch(() => null);
    // An older refresh must not overwrite a newer one's result.
    if (my !== seq.current) return;
    if (isUnauthorized(res) || !res?.ok) {
      setLoaded(true);
      return;
    }
    const list = ((await res.json()) as { watches: WatchItem[] }).watches;
    // Something changed here meanwhile: the next refresh has the truth.
    if (edits.current !== started) {
      setLoaded(true);
      return;
    }
    setWatches(list);
    await loadChanges(list);
    setLoaded(true);
  }, [loadChanges]);

  // One refresh per REFRESH_MS, also when the tab comes back.
  usePoll(refresh, { every: REFRESH_MS });

  const isWatching = useCallback((kind: WatchKind, id: string) => watches.some((w) => w.kind === kind && w.targetId === id), [watches]);

  const toggle = useCallback(
    async (kind: WatchKind, id: string) => {
      edits.current++;
      const was = latest.current.watches.find((w) => w.kind === kind && w.targetId === id);
      if (was) {
        setWatches((l) => l.filter((w) => w !== was));
        const res = await fetch(`/api/watches?kind=${kind}&targetId=${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => null);
        if (!res?.ok) {
          setWatches((l) => [...l, was]);
          toast({ kind: "error", message: "Couldn't stop watching" });
        }
        return;
      }
      const optimistic: WatchItem = { kind, targetId: id, lastSeenAt: new Date().toISOString() };
      setWatches((l) => [...l, optimistic]);
      const res = await fetch("/api/watches", { method: "PUT", headers: json, body: JSON.stringify({ kind, targetId: id }) }).catch(() => null);
      if (!res?.ok) {
        setWatches((l) => l.filter((w) => w !== optimistic));
        toast({ kind: "error", message: "Couldn't watch that" });
      }
    },
    [toast],
  );

  const markSeen = useCallback(
    async (kind: WatchKind, id: string) => {
      if (!latest.current.watches.some((w) => w.kind === kind && w.targetId === id)) return;
      edits.current++;
      const key = watchKey(kind, id);
      const removed = changesRef.current[key];
      setChanges((c) => {
        const { [key]: _gone, ...rest } = c;
        void _gone;
        return rest;
      });
      const res = await fetch("/api/watches/seen", { method: "POST", headers: json, body: JSON.stringify({ kind, targetId: id }) }).catch(() => null);
      if (!res?.ok) {
        // Not marked: put the changes back rather than hide them until the
        // next refresh.
        if (removed) setChanges((c) => ({ ...c, [key]: removed }));
        toast({ kind: "error", message: "Couldn't mark as seen" });
        return;
      }
      const body = (await res.json().catch(() => null)) as { watch: WatchItem | null } | null;
      if (body?.watch) setWatches((l) => l.map((w) => (w.kind === kind && w.targetId === id ? body.watch! : w)));
    },
    [toast],
  );

  const unseen = useMemo(() => watches.filter((w) => (changes[watchKey(w.kind, w.targetId)]?.length ?? 0) > 0).length, [watches, changes]);
  const value = useMemo(() => ({ watches, changes, loaded, isWatching, toggle, markSeen, refresh, unseen }), [watches, changes, loaded, isWatching, toggle, markSeen, refresh, unseen]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
