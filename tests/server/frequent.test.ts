import { describe, expect, it } from "vitest";
import { FREQUENT_BURST_MS, rankFrequent, type Use } from "@/lib/server/frequent";

const MIN = 60_000;
/** `n` adds of `key`, a minute apart, starting at `from`. */
const adds = (key: string, n: number, from = 0): Use[] => Array.from({ length: n }, (_, i) => ({ key, at: from + i * MIN }));

describe("the most used choices (SPEC §4.8)", () => {
  it("fewer than 3 adds never promote a choice", () => {
    expect(rankFrequent([...adds("once", 1), ...adds("twice", 2)])).toEqual([]);
    expect(rankFrequent(adds("design needed", 3))).toEqual(["design needed"]);
  });

  it("at most 3, most used first", () => {
    const uses = [...adds("a", 3), ...adds("b", 6), ...adds("c", 5), ...adds("d", 4)];
    expect(rankFrequent(uses)).toEqual(["b", "c", "d"]);
  });

  it("a tie goes to the one used last", () => {
    expect(rankFrequent([...adds("older", 3, 0), ...adds("newer", 3, 10 * MIN)])).toEqual(["newer", "older"]);
  });

  it("a bulk edit is one use, however many issues it wrote and however long it ran", () => {
    // 40 issues, 2 s apart: 78 s in all, each within the burst window of the one before.
    const bulk: Use[] = Array.from({ length: 40 }, (_, i) => ({ key: "bulk", at: i * 2000 }));
    expect(rankFrequent(bulk)).toEqual([]);
    expect(rankFrequent([...bulk, ...adds("bulk", 2, 10 * MIN)])).toEqual(["bulk"]);
  });

  it("adds further apart than the burst window count one each, in any input order", () => {
    const uses: Use[] = [0, 1, 2].map((i) => ({ key: "k", at: i * (FREQUENT_BURST_MS + 1) }));
    expect(rankFrequent([...uses].reverse())).toEqual(["k"]);
  });
});
