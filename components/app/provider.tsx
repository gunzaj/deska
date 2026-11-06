"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ClientData, ClientIssue, ClientOption, ClientRelease, SingleSelectKey, WireData, WireIssue } from "@/lib/client/types";
import { preloadAppFetches } from "@/lib/client/preload";
import type { RelativeRelease } from "@/lib/views/engine";
import type { View } from "@/lib/views/view";
import { isUnauthorized } from "@/lib/client/session";
import { ToastProvider } from "../ui/toast";
import { Loading } from "./loading";
import { useIssueData, withViewer } from "./use-issue-data";
import { useSyncStatus, type SyncState } from "./use-sync-status";
import { useTheme, type Theme } from "./use-theme";
import { useViews } from "./use-views";

export type { Theme } from "./use-theme";

/** Issue rows and everything derived from them; changes only when the data does. */
type DataCtx = {
  data: ClientData;
  viewer: string;
  byNumber: Map<number, ClientIssue>;
  byNodeId: Map<string, ClientIssue>;
  option: (field: SingleSelectKey, id: string | null | undefined) => ClientOption | null;
  release: (id: string | null | undefined) => ClientRelease | null;
  resolveRelease: (which: RelativeRelease) => string | null;
  avatarOf: (login: string) => string | null;
  labelColor: (id: string) => string | null;
  typeColor: (id: string | null | undefined) => string | null;
  refresh: () => Promise<void>;
  /**
   * Optimistic issue edits (W2). `overlayIssue` lays wire keys over the
   * loaded row (kept across refreshes until cleared); `clearOverlay` drops
   * them; `commitIssue` writes them into the loaded row itself.
   */
  wireIssue: (nodeId: string) => WireIssue | undefined;
  overlayIssue: (nodeId: string, patch: Partial<WireIssue>) => void;
  clearOverlay: (nodeId: string, keys: string[]) => void;
  commitIssue: (nodeId: string, patch: Partial<WireIssue>) => void;
};

/** The sync chip's state. It changes every few seconds; rows must not re-render for it. */
type SyncCtx = {
  sync: SyncState;
  syncNow: () => Promise<void>;
  /** When set, the last background refresh failed; the data is from this time (ms). */
  staleSince: number | null;
};

type ViewsCtx = {
  views: View[];
  upsertView: (v: View) => Promise<View | null>;
  removeView: (id: string) => Promise<boolean>;
  /** Undo a view delete (U1). */
  restoreView: (id: string) => Promise<View | null>;
};

type ThemeCtx = { theme: Theme; setTheme: (t: Theme) => void };

/** Everything in one object. Prefer the narrow hooks: this one re-renders on every change. */
type Ctx = DataCtx & SyncCtx & ViewsCtx & ThemeCtx;

// Four contexts instead of one big value (v5 3.2): a sync-status poll, a view
// save or a theme change no longer re-renders every row, card and sidebar item.
const DataContext = createContext<DataCtx | null>(null);
const SyncContext = createContext<SyncCtx | null>(null);
const ViewsContext = createContext<ViewsCtx | null>(null);
const ThemeContext = createContext<ThemeCtx | null>(null);

function need<T>(c: T | null, name: string): T {
  if (!c) throw new Error(`${name} outside AppProvider`);
  return c;
}

export const useAppData = (): DataCtx => need(useContext(DataContext), "useAppData");
export const useAppSync = (): SyncCtx => need(useContext(SyncContext), "useAppSync");
export const useAppViews = (): ViewsCtx => need(useContext(ViewsContext), "useAppViews");
export const useAppTheme = (): ThemeCtx => need(useContext(ThemeContext), "useAppTheme");

/** All four, merged. Re-renders when any of them changes; use the narrow hooks where it matters. */
export function useApp(): Ctx {
  const d = useAppData();
  const s = useAppSync();
  const v = useAppViews();
  const t = useAppTheme();
  return useMemo(() => ({ ...d, ...s, ...v, ...t }), [d, s, v, t]);
}

export function AppProvider({ viewer, children }: { viewer: string; children: ReactNode }) {
  const [wire, setWire] = useState<WireData | null>(null);
  const [views, setViews] = useState<View[] | null>(null);
  const [etag, setEtag] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // The mount load and the "Try again" button can overlap: only the newest wins.
  const loadSeq = useRef(0);
  const load = useCallback(async () => {
    const my = ++loadSeq.current;
    setLoadError(null);
    try {
      // /api/data: default cache mode, so the browser revalidates with the ETag
      // and an unchanged cache costs a 304 (S5).
      const [d, v] = await Promise.all([fetch("/api/data"), fetch("/api/views", { cache: "no-store" })]);
      if (isUnauthorized(d) || isUnauthorized(v)) return;
      if (!d.ok || !v.ok) {
        const body = await (d.ok ? v : d).json().catch(() => null);
        throw new Error(body?.error ?? `HTTP ${d.ok ? v.status : d.status}`);
      }
      const [wire, views] = await Promise.all([d.json(), v.json()]);
      if (my !== loadSeq.current) return;
      setWire(withViewer(wire, viewer));
      setEtag(d.headers.get("etag"));
      setViews(views);
    } catch (e) {
      if (my === loadSeq.current) setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, [viewer]);
  useEffect(() => {
    // Alongside the issue payload, not after it (v5 3.9).
    preloadAppFetches();
    void load();
  }, [load]);

  if (!wire || !views) return <Loading viewer={viewer} error={loadError} retry={() => void load()} />;
  return (
    <Loaded viewer={viewer} initialWire={wire} initialViews={views} initialEtag={etag}>
      {children}
    </Loaded>
  );
}

function Loaded({ viewer, initialWire, initialViews, initialEtag, children }: { viewer: string; initialWire: WireData; initialViews: View[]; initialEtag: string | null; children: ReactNode }) {
  const { data, refresh, staleSince, wireIssue, overlayIssue, clearOverlay, commitIssue } = useIssueData(viewer, initialWire, initialEtag);
  const { sync, syncNow } = useSyncStatus(refresh);
  const { views, upsertView, removeView, restoreView } = useViews(initialViews);
  const { theme, setTheme } = useTheme();

  const dataValue = useMemo<DataCtx>(() => {
    const { meta, issues } = data;
    const byNumber = new Map(issues.map((i) => [i.number, i]));
    const byNodeId = new Map(issues.map((i) => [i.nodeId, i]));
    const opts = new Map<string, ClientOption>();
    for (const [k, list] of Object.entries(meta.fields)) for (const o of list) opts.set(`${k}:${o.id}`, o);
    const rel = new Map(meta.releases.map((r) => [r.id, r]));
    const avatars = new Map(meta.users.map((u) => [u.login.toLowerCase(), u.avatarUrl]));
    const labelColors = new Map(meta.labels.map((l) => [l.id, l.color]));
    const typeColors = new Map(meta.issueTypes.map((t) => [t.id, t.color]));
    return {
      data,
      viewer: meta.viewer,
      byNumber,
      byNodeId,
      option: (field, id) => (id ? (opts.get(`${field}:${id}`) ?? null) : null),
      release: (id) => (id ? (rel.get(id) ?? null) : null),
      resolveRelease: (which) =>
        which === "current" ? meta.currentReleaseId : which === "next" ? meta.nextReleaseId : meta.previousReleaseId,
      avatarOf: (login) => avatars.get(login.toLowerCase()) ?? null,
      labelColor: (id) => labelColors.get(id) ?? null,
      typeColor: (id) => (id ? (typeColors.get(id) ?? null) : null),
      refresh,
      wireIssue,
      overlayIssue,
      clearOverlay,
      commitIssue,
    };
  }, [data, refresh, wireIssue, overlayIssue, clearOverlay, commitIssue]);
  const syncValue = useMemo<SyncCtx>(() => ({ sync, syncNow, staleSince }), [sync, syncNow, staleSince]);
  const viewsValue = useMemo<ViewsCtx>(() => ({ views, upsertView, removeView, restoreView }), [views, upsertView, removeView, restoreView]);
  const themeValue = useMemo<ThemeCtx>(() => ({ theme, setTheme }), [theme, setTheme]);

  return (
    <DataContext.Provider value={dataValue}>
      <SyncContext.Provider value={syncValue}>
        <ViewsContext.Provider value={viewsValue}>
          <ThemeContext.Provider value={themeValue}>
            <ToastProvider>{children}</ToastProvider>
          </ThemeContext.Provider>
        </ViewsContext.Provider>
      </SyncContext.Provider>
    </DataContext.Provider>
  );
}
