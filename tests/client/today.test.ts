import { describe, expect, it } from "vitest";
import { releasesOn, viewerToday, withViewerToday } from "@/lib/client/today";
import type { ClientRelease, WireData } from "@/lib/client/types";

const releases: ClientRelease[] = [
  { id: "R1", title: "Sprint 1", startDate: "2026-10-27", duration: 14, endDate: "2026-11-10" },
  { id: "R2", title: "Sprint 2", startDate: "2026-11-10", duration: 14, endDate: "2026-11-24" },
  { id: "R3", title: "Sprint 3", startDate: "2026-11-24", duration: 14, endDate: "2026-12-08" },
];

describe("the viewer's today", () => {
  // Tuesday 01:30 in UTC+2 is still Monday 23:30 UTC.
  const now = new Date("2026-11-09T23:30:00Z");

  it("is the date in the viewer's zone, not the UTC date the server used", () => {
    expect(now.toISOString().slice(0, 10)).toBe("2026-11-09");
    expect(viewerToday(now, "Africa/Cairo")).toBe("2026-11-10"); // UTC+2, no DST in November
    expect(viewerToday(now, "America/New_York")).toBe("2026-11-09");
  });

  it("re-resolves today and the current / next / previous Release on the client", () => {
    const wire = { meta: { today: "2026-11-09", releases, currentReleaseId: "R1", nextReleaseId: "R2", previousReleaseId: null }, issues: [] } as unknown as WireData;
    const local = withViewerToday(wire, viewerToday(now, "Africa/Cairo"));
    expect(local.meta).toMatchObject({ today: "2026-11-10", currentReleaseId: "R2", nextReleaseId: "R3", previousReleaseId: "R1" });
    expect(withViewerToday(wire, "2026-11-09")).toBe(wire);
  });

  it("resolves Releases like the server does", () => {
    expect(releasesOn(releases, "2026-11-23")).toEqual({ currentReleaseId: "R2", nextReleaseId: "R3", previousReleaseId: "R1" });
    expect(releasesOn(releases, "2027-01-01")).toEqual({ currentReleaseId: null, nextReleaseId: null, previousReleaseId: null });
  });
});
