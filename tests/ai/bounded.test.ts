// Item 6: triage inputs are built in bounded parallel, in input order.
import { describe, expect, it } from "vitest";
import { mapBounded } from "@/lib/ai/bounded";

describe("mapBounded", () => {
  it("runs at most `limit` at once and keeps the input order", async () => {
    let running = 0;
    let peak = 0;
    const out = await mapBounded([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 3, async (n) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 5));
      running--;
      return n * 2;
    });
    expect(out).toEqual([2, 4, 6, 8, 10, 12, 14, 16, 18, 20]);
    expect(peak).toBe(3);
  });

  it("copes with an empty list and a limit above the list", async () => {
    expect(await mapBounded([], 4, async (n: number) => n)).toEqual([]);
    expect(await mapBounded(["a", "b"], 99, async (v) => v.toUpperCase())).toEqual(["A", "B"]);
    expect(await mapBounded([1], 0, async (n) => n + 1)).toEqual([2]);
  });
});
