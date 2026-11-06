// S1: one sync at a time. The lock is an in-process mutex (SPEC §2.1).
import { describe, expect, it, vi } from "vitest";
import { withSyncLock } from "@/lib/sync/lock";

const gate = () => {
  let open!: () => void;
  const opened = new Promise<void>((r) => (open = r));
  return { opened, open };
};

describe("withSyncLock (no database)", () => {
  it("skips a second concurrent call; fn runs once", async () => {
    const g = gate();
    const fn = vi.fn(async () => {
      await g.opened;
      return "done";
    });
    const first = withSyncLock(fn);
    const second = await withSyncLock(fn);
    expect(second).toEqual({ ran: false });
    g.open();
    expect(await first).toEqual({ ran: true, value: "done" });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("releases the lock when fn throws", async () => {
    await expect(withSyncLock(async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    expect(await withSyncLock(async () => 1)).toEqual({ ran: true, value: 1 });
  });

  it("waits for the holder when waitMs is given", async () => {
    const g = gate();
    const first = withSyncLock(() => g.opened);
    setTimeout(g.open, 30);
    const second = await withSyncLock(async () => "late", { waitMs: 2_000, retryMs: 10 });
    expect(second).toEqual({ ran: true, value: "late" });
    await first;
  });

  it("gives up after waitMs", async () => {
    const g = gate();
    const first = withSyncLock(() => g.opened);
    expect(await withSyncLock(async () => "never", { waitMs: 40, retryMs: 10 })).toEqual({ ran: false });
    g.open();
    await first;
  });
});
