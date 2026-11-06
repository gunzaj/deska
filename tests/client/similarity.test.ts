import { describe, expect, it } from "vitest";
import { CLOSED_WINDOW_DAYS, findDuplicates, MAX_DUPLICATES, similarity, trigrams } from "@/lib/client/similarity";

const row = (number: number, title: string, state = "open", closedAt: string | null = null) => ({ number, title, state, url: `https://github.com/x/y/issues/${number}`, closedAt });

describe("title similarity (F7)", () => {
  it("is pg_trgm's measure", () => {
    // From the pg_trgm documentation: similarity('word', 'two words') = 0.363636.
    expect(trigrams("word")).toEqual(new Set(["  w", " wo", "wor", "ord", "rd "]));
    expect(similarity("word", "two words")).toBeCloseTo(0.3636, 3);
    expect(similarity("Crash on start", "crash ON start!")).toBe(1);
    expect(similarity("", "anything")).toBe(0);
  });

  it("two issues with near-identical titles find each other; unrelated titles don't", () => {
    const rows = [
      row(1, "Crash when sending a transaction with a custom fee"),
      row(2, "Crash when sending transaction with custom fee"),
      row(3, "Add dark mode to the settings page"),
    ];
    expect(findDuplicates(rows, rows[0]!).map((d) => d.number)).toEqual([2]);
    expect(findDuplicates(rows, rows[1]!).map((d) => d.number)).toEqual([1]);
    expect(findDuplicates(rows, rows[2]!)).toEqual([]);
  });

  it("never lists the issue itself; open and recently closed only; best three first", () => {
    const now = Date.parse("2026-10-13T00:00:00Z");
    const recent = new Date(now - 10 * 86_400_000).toISOString();
    const old = new Date(now - (CLOSED_WINDOW_DAYS + 5) * 86_400_000).toISOString();
    const base = "Widget Pro firmware update fails on Windows";
    const rows = [
      row(1, base),
      row(2, base),
      row(3, "Widget Pro firmware update fails on Windows 11"),
      row(4, "Widget Pro firmware update failing on Windows", "closed", recent),
      row(5, base, "closed", old),
      row(6, "Acme firmware update fails on Windows", "open"),
    ];
    const got = findDuplicates(rows, rows[0]!, now);
    expect(got.length).toBe(MAX_DUPLICATES);
    expect(got.map((d) => d.number)).not.toContain(1);
    expect(got.map((d) => d.number)).not.toContain(5);
    expect(got[0]).toMatchObject({ number: 2, similarity: 1 });
    expect(got.map((d) => d.similarity)).toEqual([...got.map((d) => d.similarity)].sort((a, b) => b - a));
  });
});
