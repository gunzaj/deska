// F3 against Postgres: personal triage snoozes.
// Runs on an in-memory PGlite database (tests/setup/db.ts).
import { beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { runRetention } from "@/lib/maintenance/retention";
import { clearSnooze, listSnoozes, setSnooze } from "@/lib/triage/snoozes";

describe("triage snoozes (Postgres)", () => {
  beforeEach(async () => {
    await getDb().execute(sql`TRUNCATE triage_snoozes`);
  });

  it("keeps each person's snoozes apart, updates in place and clears", async () => {
    await setSnooze("Alice", "I_1", "2026-10-20");
    await setSnooze("alice", "I_1", "2026-10-25");
    await setSnooze("bob", "I_2", "2026-10-21");
    expect(await listSnoozes("alice")).toEqual([{ nodeId: "I_1", until: "2026-10-25" }]);
    expect(await listSnoozes("bob")).toEqual([{ nodeId: "I_2", until: "2026-10-21" }]);
    await clearSnooze("alice", "I_1");
    expect(await listSnoozes("alice")).toEqual([]);
    expect(await listSnoozes("bob")).toHaveLength(1);
  });

  it("retention drops snoozes whose day has passed", async () => {
    await setSnooze("alice", "I_old", "2026-10-10");
    await setSnooze("alice", "I_new", "2026-10-20");
    const res = await runRetention(new Date("2026-10-13T03:00:00Z"));
    expect(res.snoozes).toBe(1);
    expect((await listSnoozes("alice")).map((s) => s.nodeId)).toEqual(["I_new"]);
  });
});
