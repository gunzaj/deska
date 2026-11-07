// v5 2.4: "Sync now" reads the shared state read-only, outside the lock.
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/sync/runtime", async (orig) => {
  const real = await orig<typeof import("@/lib/sync/runtime")>();
  return { ...real, getSyncKv: vi.fn(real.getSyncKv) };
});
const runtime = await import("@/lib/sync/runtime");
const { triggerSync } = await import("@/lib/sync/trigger");
import { MemoryStore } from "@/lib/sync/store-memory";

const source = {
  checkChanges: vi.fn(async () => ({ kind: "not-modified" as const })),
  scanProjectItems: vi.fn(async () => ({ items: [], nextCursor: null, total: 0 })),
};

describe("triggerSync outside the lock", () => {
  it("never refreshes the shared KV cache a running cycle uses", async () => {
    const kv = await runtime.getSyncKv();
    kv.set("issues.since", "2026-10-01T00:00:00Z");
    vi.mocked(runtime.getSyncKv).mockClear();

    const first = await triggerSync(source, new MemoryStore(), { manual: true });
    expect(first.kind).toBe("ran");
    const second = await triggerSync(source, new MemoryStore(), { manual: true });
    expect(second).toMatchObject({ kind: "skipped", skipped: "too-soon" });
    // The throttle check (and a skip's lastSync read) use readSharedKv, not getSyncKv.
    expect(runtime.getSyncKv).not.toHaveBeenCalled();
    kv.set("sync.lastAttemptAt", "");
  });
});
