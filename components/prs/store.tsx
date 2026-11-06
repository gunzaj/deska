"use client";

import { fetchPreloaded } from "@/lib/client/preload";
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { requestedFrom, type PrCtx } from "@/lib/client/prs";
import { isUnauthorized } from "@/lib/client/session";
import { usePoll } from "@/lib/client/poll";
import type { ClientPr, PrData } from "@/lib/client/types";
import { useAppData } from "../app/provider";

/**
 * PR lens data (SPEC §13.3). Loaded after the issue data so the first paint
 * isn't slowed down, then refreshed with the issue data's cadence.
 */
type PrsCtx = {
  prs: ClientPr[];
  loaded: boolean;
  /** The last load failed (S3); PR pages show it with Retry instead of "Loading…". */
  error: string | null;
  retry: () => Promise<void>;
  byNumber: Map<number, ClientPr>;
  byNodeId: Map<string, ClientPr>;
  ctx: PrCtx;
  /** PRs that close this issue (by node ID). */
  closing: (issueNodeId: string) => ClientPr[];
  reviewQueue: ClientPr[];
  myOpen: ClientPr[];
};

const Ctx = createContext<PrsCtx | null>(null);

export function usePrs(): PrsCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("usePrs outside PrsProvider");
  return c;
}

const REFRESH_MS = 120_000;

export function PrsProvider({ children }: { children: ReactNode }) {
  const { viewer } = useAppData();
  const [data, setData] = useState<PrData>({ prs: [], myTeams: [] });
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const last = useRef(0);
  const seq = useRef(0);

  const load = useCallback(async () => {
    // The interval and visibilitychange can overlap; an older answer mustn't win.
    const mine = ++seq.current;
    // Default cache mode: the browser revalidates with the ETag and an
    // unchanged cache costs a 304, not the whole list (S5).
    const res = await fetchPreloaded("/api/prs").catch(() => null);
    if (isUnauthorized(res)) return;
    if (!res?.ok) {
      if (mine !== seq.current) return;
      // Keep any data already shown; the pages say it couldn't be refreshed.
      setError(res ? `HTTP ${res.status}` : "Network error");
      return;
    }
    const body = (await res.json().catch(() => null)) as PrData | null;
    if (mine !== seq.current) return;
    if (!body) {
      // A 2xx whose body doesn't parse is a malformed response, not "HTTP 200".
      setError("Malformed response");
      return;
    }
    setData(body);
    setLoaded(true);
    setError(null);
    last.current = Date.now();
  }, []);

  usePoll(load, { every: 30_000, minGap: REFRESH_MS, lastRun: last });

  const value = useMemo<PrsCtx>(() => {
    const ctx: PrCtx = { me: viewer.toLowerCase(), myTeams: data.myTeams };
    const byClosing = new Map<string, ClientPr[]>();
    for (const p of data.prs) for (const id of p.closingIssues) byClosing.set(id, [...(byClosing.get(id) ?? []), p]);
    return {
      prs: data.prs,
      loaded,
      error,
      retry: load,
      byNumber: new Map(data.prs.map((p) => [p.number, p])),
      byNodeId: new Map(data.prs.map((p) => [p.nodeId, p])),
      ctx,
      closing: (id) => byClosing.get(id) ?? [],
      reviewQueue: data.prs.filter((p) => p.state === "open" && !p.isDraft && requestedFrom(p, ctx)),
      myOpen: data.prs.filter((p) => p.state === "open" && p.author.toLowerCase() === ctx.me),
    };
  }, [data, loaded, error, load, viewer]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
