// One polling loop for every client store (v5 4.7). Seven hand-written ones
// disagreed: the outbox poll ran in hidden tabs and after the session expired,
// comments did not catch up when the tab came back, and the visibility and
// focus handlers each fired a refresh. A poll here:
//  - runs only while the tab is visible and the session has not expired,
//  - catches up when the tab becomes visible or focused again, at most once
//    per `minGap`,
//  - never runs twice within `minGap`.
import { useEffect, useRef, type MutableRefObject } from "react";
import { sessionExpired, useSessionExpired } from "./session";

export type PollOptions = {
  /** Milliseconds between ticks. */
  every: number;
  /**
   * Skip a run when the previous one was this recent. Ticks only honour an
   * explicit value (the interval is the cadence); catching up after the tab
   * returns defaults to `every`.
   */
  minGap?: number;
  /** Also run when the tab becomes visible or the window gains focus (default true). */
  catchUp?: boolean;
  /** Run once when the poll starts, even in a hidden tab (default true). */
  immediate?: boolean;
  /** Pause the poll without unmounting (default true). */
  enabled?: boolean;
  /**
   * When the last successful run happened, written by the caller. Without it
   * the poll uses the time it last started `fn`. Use it when `fn` can also be
   * triggered by hand and a manual run should count.
   */
  lastRun?: MutableRefObject<number>;
};

/** What the poll reads from the page; swapped for fakes in tests. */
export type PollEnv = {
  now(): number;
  visible(): boolean;
  expired(): boolean;
  /** Calls `fn` when the tab becomes visible or the window gains focus. Returns the unsubscribe. */
  onReturn(fn: () => void): () => void;
};

const browserEnv: PollEnv = {
  now: () => Date.now(),
  visible: () => document.visibilityState === "visible",
  expired: sessionExpired,
  onReturn(fn) {
    document.addEventListener("visibilitychange", fn);
    window.addEventListener("focus", fn);
    return () => {
      document.removeEventListener("visibilitychange", fn);
      window.removeEventListener("focus", fn);
    };
  },
};

type CoreOptions = Omit<PollOptions, "enabled" | "lastRun"> & {
  /** When the last run happened; the poll writes it at each start when `trackStarts`. */
  last: MutableRefObject<number>;
  trackStarts: boolean;
};

/**
 * Start the timers and listeners; returns the stop function. `run` may be
 * async; it is not awaited.
 */
export function startPoll(run: () => unknown, opts: CoreOptions, env: PollEnv = browserEnv): () => void {
  const go = (gap: number, needsVisible = true) => {
    if (env.expired() || (needsVisible && !env.visible())) return;
    if (gap > 0 && env.now() - opts.last.current < gap) return;
    if (opts.trackStarts) opts.last.current = env.now();
    void run();
  };
  // The first run is not tied to visibility: a store opened in a background
  // tab still loads its data (the ticks wait until the tab is shown).
  if (opts.immediate !== false) go(0, false);
  const timer = setInterval(() => go(opts.minGap ?? 0), opts.every);
  const stopReturn = opts.catchUp === false ? () => {} : env.onReturn(() => go(opts.minGap ?? opts.every));
  return () => {
    clearInterval(timer);
    stopReturn();
  };
}

/**
 * Poll `fn` while the component is mounted. Pass a stable function
 * (`useCallback`): a new identity restarts the poll and runs `fn` again right
 * away, which is what a poll of another task needs. It stops for good once the
 * session has expired.
 */
export function usePoll(fn: () => unknown, opts: PollOptions): void {
  const { every, minGap, catchUp, immediate, enabled = true, lastRun } = opts;
  const own = useRef(0);
  const expired = useSessionExpired();
  const live = enabled && !expired;

  useEffect(() => {
    if (!live) return;
    return startPoll(fn, { every, minGap, catchUp, immediate, last: lastRun ?? own, trackStarts: !lastRun });
  }, [live, fn, every, minGap, catchUp, immediate, lastRun]);
}
