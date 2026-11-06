"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { applyWire } from "@/lib/client/edit";
import { hydrate } from "@/lib/client/hydrate";
import { usePoll } from "@/lib/client/poll";
import { reuseRows } from "@/lib/client/reuse";
import { isUnauthorized } from "@/lib/client/session";
import type { WireData, WireIssue } from "@/lib/client/types";

/**
 * How often the rows are re-read while the tab is visible. The local server
 * answers an unchanged cache with the same ETag, so a poll costs nothing; a
 * change the sync service brought in shows within one cycle plus this (D5).
 */
export const REFRESH_MS = 10_000;

/**
 * The payload names no viewer (it is the same for everyone, so one serialized
 * body serves every request); the browser knows who is signed in (v5 3.7).
 */
export function withViewer(w: WireData, viewer: string): WireData {
  w.meta.viewer = viewer;
  return w;
}

/**
 * The issue rows on screen: the wire payload, optimistic overlays laid over it
 * (W2), the background refresh, and how stale the rows are when it fails.
 */
export function useIssueData(viewer: string, initialWire: WireData, initialEtag: string | null) {
  const [wire, setWire] = useState<WireData>(initialWire);
  // The ETag of the payload on screen: a refresh that answers with the same
  // one (the browser turns a 304 into a cached 200) changes nothing (v5 3.3).
  const etag = useRef(initialEtag);
  const [overlay, setOverlay] = useState<Map<string, Partial<WireIssue>>>(() => new Map());
  const data = useMemo(
    () => hydrate(overlay.size ? { ...wire, issues: wire.issues.map((w) => (overlay.has(w.id) ? applyWire(w, overlay.get(w.id)!) : w)) } : wire),
    [wire, overlay],
  );
  const wireRef = useRef(wire);
  wireRef.current = wire;
  const overlayRef = useRef(overlay);
  overlayRef.current = overlay;
  const wireIssue = useCallback((nodeId: string) => {
    const w = wireRef.current.issues.find((x) => x.id === nodeId);
    const o = overlayRef.current.get(nodeId);
    return w && o ? applyWire(w, o) : w;
  }, []);
  const overlayIssue = useCallback((nodeId: string, patch: Partial<WireIssue>) => {
    setOverlay((prev) => new Map(prev).set(nodeId, { ...prev.get(nodeId), ...patch }));
  }, []);
  const clearOverlay = useCallback((nodeId: string, keys: string[]) => {
    setOverlay((prev) => {
      const cur = prev.get(nodeId);
      if (!cur) return prev;
      const rest = Object.fromEntries(Object.entries(cur).filter(([k]) => !keys.includes(k)));
      const next = new Map(prev);
      if (Object.keys(rest).length) next.set(nodeId, rest);
      else next.delete(nodeId);
      return next;
    });
  }, []);
  const commitIssue = useCallback((nodeId: string, patch: Partial<WireIssue>) => {
    setWire((prev) => ({ ...prev, issues: prev.issues.map((w) => (w.id === nodeId ? applyWire(w, patch) : w)) }));
  }, []);

  const lastFetch = useRef(Date.now());
  const [staleSince, setStaleSince] = useState<number | null>(null);
  // Background polls and "Sync now" can overlap; only the newest request may apply.
  const fetchSeq = useRef(0);

  // A failed refresh keeps the data and says how old it is (S3); a 401 stops
  // everything behind the session-expired banner instead.
  const refresh = useCallback(async () => {
    const seq = ++fetchSeq.current;
    let ok = false;
    try {
      const res = await fetch("/api/data");
      if (isUnauthorized(res)) return;
      if (res.ok) {
        const tag = res.headers.get("etag");
        if (tag && tag === etag.current) {
          // Unchanged: skip the parse and every rebuild behind it.
          lastFetch.current = Date.now();
          ok = true;
        } else {
          const next = (await res.json()) as WireData;
          if (seq !== fetchSeq.current) return;
          etag.current = tag;
          setWire((prev) => reuseRows(prev, withViewer(next, viewer)));
          lastFetch.current = Date.now();
          ok = true;
        }
      }
    } catch {
      /* offline: keep what we have */
    }
    if (seq !== fetchSeq.current) return;
    setStaleSince(ok ? null : lastFetch.current);
  }, [viewer]);

  // Background freshness: while the tab is visible, and when it comes back.
  usePoll(refresh, { every: REFRESH_MS, minGap: REFRESH_MS, lastRun: lastFetch, immediate: false });

  return { data, refresh, staleSince, wireIssue, overlayIssue, clearOverlay, commitIssue };
}
