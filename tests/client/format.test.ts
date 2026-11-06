import { describe, expect, it } from "vitest";
import { formatDate, lastDay } from "@/lib/client/format";

describe("dates", () => {
  it("formats a bare release date as that calendar day in every time zone", () => {
    // Release dates are YYYY-MM-DD; local-time formatting showed the day before west of UTC.
    const now = Date.parse("2026-10-12T12:00:00Z");
    expect(formatDate("2026-10-01", now)).toBe("1 Oct");
    expect(formatDate("2025-12-31", now)).toBe("31 Dec 2025");
  });

  it("turns an exclusive release end into its last day", () => {
    expect(lastDay("2026-10-15")).toBe("2026-10-14");
    expect(lastDay("2026-03-01")).toBe("2026-02-28");
    expect(lastDay("2027-01-01")).toBe("2026-12-31");
  });
});
