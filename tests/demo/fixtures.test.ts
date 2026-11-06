import { describe, expect, it } from "vitest";
import { fixtureSnapshot } from "@/lib/demo/fixtures";

function currentRelease(now: Date) {
  const iterations = fixtureSnapshot(now).fields.find((f) => f.name === "Release")!.iterations!;
  const today = Date.parse(`${now.toISOString().slice(0, 10)}T12:00:00Z`);
  return iterations.find((r) => {
    const s = Date.parse(`${r.startDate}T00:00:00Z`);
    return s <= today && today < s + r.duration * 86_400_000;
  });
}

describe("fixture Release iterations (v5 1.8)", () => {
  it.each(["2026-10-16", "2026-11-04", "2026-12-01", "2027-06-30"])("keeps Sprint 23 current on %s", (day) => {
    const now = new Date(`${day}T09:00:00Z`);
    expect(currentRelease(now)?.title).toBe("Sprint 23");
  });

  it("keeps Sprint 22 as the Release right before the current one", () => {
    const [cur, prev] = fixtureSnapshot(new Date("2026-12-01T00:00:00Z")).fields.find((f) => f.name === "Release")!.iterations!;
    const prevEnd = Date.parse(`${prev!.startDate}T00:00:00Z`) + prev!.duration * 86_400_000;
    expect(prevEnd).toBe(Date.parse(`${cur!.startDate}T00:00:00Z`));
  });
});
