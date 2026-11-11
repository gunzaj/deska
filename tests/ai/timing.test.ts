// Item 6: the elapsed time shown next to a running AI action.
import { describe, expect, it } from "vitest";
import { elapsedSince, formatDuration } from "@/lib/ai/timing";

describe("AI elapsed time", () => {
  it("shows tenths under ten seconds, whole seconds under a minute, then minutes", () => {
    expect(formatDuration(0)).toBe("0.0 s");
    expect(formatDuration(1_250)).toBe("1.3 s");
    expect(formatDuration(9_949)).toBe("9.9 s");
    expect(formatDuration(12_400)).toBe("12 s");
    expect(formatDuration(59_400)).toBe("59 s");
    expect(formatDuration(65_000)).toBe("1 min 05 s");
    expect(formatDuration(3_725_000)).toBe("62 min 05 s");
    expect(formatDuration(-1)).toBe("0.0 s");
  });

  it("measures from an ISO time and refuses an unreadable one", () => {
    expect(elapsedSince("2026-01-01T00:00:00.000Z", Date.parse("2026-01-01T00:00:02.500Z"))).toBe(2_500);
    expect(elapsedSince("2026-01-01T00:00:02.500Z", Date.parse("2026-01-01T00:00:00.000Z"))).toBe(0);
    expect(elapsedSince("not a date", 0)).toBeNull();
  });
});
