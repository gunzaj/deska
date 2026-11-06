"use client";

// The viewer's triage snoozes (IMPROVEMENTS F3): loaded once, changed
// optimistically. Kept in Deska only, so they work with writes off.
import { fetchPreloaded } from "@/lib/client/preload";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { isUnauthorized } from "@/lib/client/session";
import { useToast } from "../ui/toast";

type Ctx = {
  /** Node ID → first day the issue is back. Includes expired ones; use `isSnoozed`. */
  snoozes: ReadonlyMap<string, string>;
  loaded: boolean;
  snooze: (nodeId: string, until: string) => Promise<void>;
  unsnooze: (nodeId: string) => Promise<void>;
};

const Context = createContext<Ctx | null>(null);
const EMPTY: Ctx = { snoozes: new Map(), loaded: true, snooze: async () => {}, unsnooze: async () => {} };

export function useSnoozes(): Ctx {
  return useContext(Context) ?? EMPTY;
}

export function SnoozeProvider({ children }: { children: ReactNode }) {
  const { toast } = useToast();
  const [map, setMap] = useState<Map<string, string>>(() => new Map());
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let live = true;
    void fetchPreloaded("/api/triage/snoozes", { cache: "no-store" })
      .then(async (res) => {
        if (isUnauthorized(res) || !res.ok) return null;
        return ((await res.json()) as { snoozes: { nodeId: string; until: string }[] }).snoozes;
      })
      .catch(() => null)
      .then((list) => {
        if (!live) return;
        if (list) setMap(new Map(list.map((s) => [s.nodeId, s.until])));
        setLoaded(true);
      });
    return () => {
      live = false;
    };
  }, []);

  const snooze = useCallback(
    async (nodeId: string, until: string) => {
      const before = map.get(nodeId);
      setMap((m) => new Map(m).set(nodeId, until));
      const res = await fetch("/api/triage/snoozes", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ nodeId, until }) }).catch(() => null);
      if (!res?.ok) {
        setMap((m) => {
          const next = new Map(m);
          if (before) next.set(nodeId, before);
          else next.delete(nodeId);
          return next;
        });
        toast({ kind: "error", message: "Couldn't snooze that issue" });
      }
    },
    [map, toast],
  );

  const unsnooze = useCallback(
    async (nodeId: string) => {
      const before = map.get(nodeId);
      setMap((m) => {
        const next = new Map(m);
        next.delete(nodeId);
        return next;
      });
      const res = await fetch(`/api/triage/snoozes?nodeId=${encodeURIComponent(nodeId)}`, { method: "DELETE" }).catch(() => null);
      if (!res?.ok && before) {
        setMap((m) => new Map(m).set(nodeId, before));
        toast({ kind: "error", message: "Couldn't undo the snooze" });
      }
    },
    [map, toast],
  );

  const value = useMemo(() => ({ snoozes: map, loaded, snooze, unsnooze }), [map, loaded, snooze, unsnooze]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
