import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startPoll, type PollEnv } from "@/lib/client/poll";

// The shared poll (v5 4.7), driven with fake timers and a fake page.
function fakeEnv() {
  const state = { visible: true, expired: false };
  let back: (() => void) | null = null;
  const env: PollEnv = {
    now: () => Date.now(),
    visible: () => state.visible,
    expired: () => state.expired,
    onReturn: (fn) => {
      back = fn;
      return () => {
        back = null;
      };
    },
  };
  return { env, state, returnToTab: () => back?.(), listening: () => back !== null };
}

const poll = (run: () => unknown, env: PollEnv, opts: Partial<Parameters<typeof startPoll>[1]> = {}) =>
  startPoll(run, { every: 30_000, last: { current: 0 }, trackStarts: true, ...opts }, env);

describe("startPoll", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-16T12:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("runs at once and then on every tick", () => {
    const { env } = fakeEnv();
    const run = vi.fn();
    poll(run, env);
    expect(run).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(90_000);
    expect(run).toHaveBeenCalledTimes(4);
  });

  it("does not run at once with immediate: false", () => {
    const { env } = fakeEnv();
    const run = vi.fn();
    poll(run, env, { immediate: false });
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(30_000);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("skips ticks while the tab is hidden and once the session has expired", () => {
    const { env, state } = fakeEnv();
    const run = vi.fn();
    poll(run, env);
    state.visible = false;
    vi.advanceTimersByTime(60_000);
    expect(run).toHaveBeenCalledTimes(1);
    state.visible = true;
    vi.advanceTimersByTime(30_000);
    expect(run).toHaveBeenCalledTimes(2);
    state.expired = true;
    vi.advanceTimersByTime(90_000);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("catches up when the tab comes back, but not right after a run", () => {
    const { env, state, returnToTab } = fakeEnv();
    const run = vi.fn();
    poll(run, env);
    returnToTab(); // 0 ms after the first run: nothing to catch up on
    expect(run).toHaveBeenCalledTimes(1);
    state.visible = false;
    vi.advanceTimersByTime(25_000);
    state.visible = true;
    returnToTab(); // 25 s: under the 30 s gap
    expect(run).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(10_000);
    state.visible = false;
    vi.advanceTimersByTime(5 * 60_000);
    state.visible = true;
    returnToTab(); // long away: catches up
    expect(run).toHaveBeenCalledTimes(3);
  });

  it("minGap holds back ticks too, measured from the caller's own last-success time", () => {
    const { env } = fakeEnv();
    const last = { current: Date.now() };
    const run = vi.fn(() => {
      last.current = Date.now();
    });
    poll(run, env, { minGap: 120_000, last, trackStarts: false, immediate: false });
    vi.advanceTimersByTime(90_000);
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60_000); // 150 s since the success
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("stop clears the timer and the listeners", () => {
    const { env, listening } = fakeEnv();
    const run = vi.fn();
    const stop = poll(run, env);
    expect(listening()).toBe(true);
    stop();
    expect(listening()).toBe(false);
    vi.advanceTimersByTime(120_000);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("does not listen for the tab's return with catchUp: false", () => {
    const { env, listening } = fakeEnv();
    poll(vi.fn(), env, { catchUp: false });
    expect(listening()).toBe(false);
  });
});
