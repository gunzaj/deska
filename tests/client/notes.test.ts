import { describe, expect, it } from "vitest";
import { buildClientData } from "@/lib/client/build";
import { hydrate } from "@/lib/client/hydrate";
import { labelsInUse, releaseNotes, shippedIssues } from "@/lib/client/notes";
import { importFull } from "@/lib/sync/import";
import { MemoryStore } from "@/lib/sync/store-memory";
import { fixtureSnapshot } from "../fixtures/github";

const NOW = new Date("2026-10-12T10:00:00Z");
// The fixture Release starts 10 days before this, i.e. 7 Oct, as the snapshots expect.
const FIXTURE_NOW = new Date("2026-10-17T10:00:00Z");

/**
 * Fixture Release Sprint 23: the epic (#100) and the sub-issue (#101) are closed in
 * it, #102 was closed as not planned, #103 is still open.
 */
async function shipped() {
  const snapshot = fixtureSnapshot(FIXTURE_NOW);
  const close = (n: number, over: Record<string, unknown> = {}) => (i: (typeof snapshot.issues)[number]) => (i.number === n ? { ...i, state: "closed", closedAt: "2026-10-09T10:00:00Z", ...over } : i);
  snapshot.issues = snapshot.issues.map(close(100)).map(close(101)).map(close(102, { stateReason: "not_planned" }));
  snapshot.projectItems = snapshot.projectItems.map((p) => (p.issueNodeId === "I_sub" || p.issueNodeId === "I_bug" ? { ...p, releaseIter: "e0000023" } : p));
  const store = new MemoryStore();
  await importFull(snapshot, store);
  const data = hydrate(buildClientData(store, { viewer: "alice", writeMode: false, demo: true, now: NOW }));
  return { data, release: data.meta.releases.find((r) => r.id === "e0000023")! };
}

describe("release notes (F5)", () => {
  it("leaves out issues closed as not planned and open ones", async () => {
    const { data, release } = await shipped();
    expect(shippedIssues(data.issues, release.id).map((i) => i.number).sort()).toEqual([100, 101]);
  });

  it("matches the snapshot: grouped by Type, one line per issue, no pull request lines", async () => {
    const { data, release } = await shipped();
    expect(releaseNotes({ release, issues: data.issues, meta: data.meta })).toMatchSnapshot();
  });

  it("sub-groups by the chosen labels, listing an issue once", async () => {
    const { data, release } = await shipped();
    const used = labelsInUse(shippedIssues(data.issues, release.id), data.meta);
    const md = releaseNotes({ release, issues: data.issues, meta: data.meta, labelSet: used.map((l) => l.id) });
    expect(md).toMatchSnapshot();
    for (const n of [100, 101]) expect(md.match(new RegExp(`\\[#${n}\\]`, "g"))).toHaveLength(1);
  });

  it("says so when nothing closed", async () => {
    const { data, release } = await shipped();
    expect(releaseNotes({ release, issues: [], meta: data.meta })).toContain("Nothing closed in this Release yet");
  });
});
