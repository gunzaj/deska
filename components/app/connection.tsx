"use client";

// The GitHub connection in the UI (SPEC §3.3): `/api/connection` loaded on
// mount, again when the window comes back after a while, and on "Check
// again". Every state has its own words; an error is never shown as an empty
// list (the explorer asks `connectionProblem` before it says "No issues").
import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ConnectionStatus } from "@/lib/github/token-states";
import { Icon } from "../icons";

type ConnectionCtx = {
  status: ConnectionStatus | null;
  checking: boolean;
  /** Ask GitHub again (`?refresh=1`). */
  recheck: () => Promise<ConnectionStatus | null>;
};

const Ctx = createContext<ConnectionCtx>({ status: null, checking: false, recheck: async () => null });

export const useConnection = () => useContext(Ctx);

const REFETCH_AFTER_MS = 60_000;
// The server answers from its cache (a failed sync updates it at once, D5),
// so this asks GitHub only when that cache is due.
const POLL_MS = 15_000;

export async function fetchConnection(refresh = false): Promise<ConnectionStatus | null> {
  try {
    const res = await fetch(`/api/connection${refresh ? "?refresh=1" : ""}`, { cache: "no-store" });
    return res.ok ? ((await res.json()) as ConnectionStatus) : null;
  } catch {
    return null;
  }
}

export function ConnectionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const last = useRef(0);

  const load = useCallback(async (refresh: boolean) => {
    last.current = Date.now();
    if (refresh) setChecking(true);
    const s = await fetchConnection(refresh);
    if (s) setStatus(s);
    if (refresh) setChecking(false);
    return s;
  }, []);

  useEffect(() => {
    void load(false);
    const onFocus = () => {
      if (Date.now() - last.current > REFETCH_AFTER_MS) void load(false);
    };
    window.addEventListener("focus", onFocus);
    const t = setInterval(() => void load(false), POLL_MS);
    return () => {
      window.removeEventListener("focus", onFocus);
      clearInterval(t);
    };
  }, [load]);

  const value = useMemo(() => ({ status, checking, recheck: () => load(true) }), [status, checking, load]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** States that mean GitHub data can't be trusted to be complete right now. */
export function connectionProblem(s: ConnectionStatus | null): boolean {
  return !!s && s.state !== "ok" && s.state !== "preview";
}

/** What to do about a state, under its message. */
export function problemHint(s: ConnectionStatus): string | null {
  switch (s.state) {
    case "missing-permission":
      return "Add the permission to the token on GitHub (Settings → Developer settings → Fine-grained tokens → Edit), then check again.";
    case "awaiting-approval":
      return "An org owner approves fine-grained tokens under the org's Settings → Personal access tokens → Pending requests.";
    case "invalid":
      return "Create a new token on GitHub and replace it in Settings.";
    case "offline":
      return "Showing cached data. Deska tries again in a moment.";
    case "rate-limited":
      return "Showing cached data until then.";
    case "missing":
      return "Connect a fine-grained token to load your repository.";
    default:
      return null;
  }
}

/** The banner over every page while the connection has a problem or the token expires soon. */
export function ConnectionBanner() {
  const { status, checking, recheck } = useConnection();
  if (!status) return null;
  const problem = connectionProblem(status);
  if (!problem && !status.expiryWarning) return null;
  const tone = status.state === "invalid" || status.state === "missing" ? "bg-critical-soft" : "bg-warning-soft";
  return (
    <div role={problem ? "alert" : "status"} data-connection-state={status.state} className={`flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-4 py-1.5 text-[12.5px] ${tone}`}>
      <Icon name="alert" size={13} className="shrink-0" />
      <span className="min-w-0 flex-1">
        {problem ? <strong className="font-semibold">{status.message}</strong> : null}
        {problem && status.expiryWarning ? " · " : null}
        {status.expiryWarning}
        {problem && problemHint(status) ? <span className="text-muted"> {problemHint(status)}</span> : null}
      </span>
      {status.state === "missing" ? (
        <Link href="/onboarding" className="rounded-md px-2 py-0.5 font-medium hover:bg-hover">
          Connect GitHub
        </Link>
      ) : status.state === "invalid" || status.expiryWarning ? (
        <Link href="/settings#token" className="rounded-md px-2 py-0.5 font-medium hover:bg-hover">
          Replace token
        </Link>
      ) : null}
      {problem && status.state !== "missing" && status.state !== "invalid" && (
        <button type="button" disabled={checking} onClick={() => void recheck()} className="rounded-md px-2 py-0.5 font-medium hover:bg-hover disabled:opacity-60">
          {checking ? "Checking…" : "Check again"}
        </button>
      )}
    </div>
  );
}
