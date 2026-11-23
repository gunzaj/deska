// The frequent label and assignee choices, read from the audit log on an
// in-memory PGlite database (tests/setup/db.ts).
import { beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";

describe("frequent choices from the audit log (SPEC §4.8)", async () => {
  const { getDb } = await import("@/db");
  const { frequentChoices, FREQUENT_DAYS } = await import("@/lib/server/frequent");

  const NOW = Date.parse("2026-11-20T12:00:00Z");
  const daysAgo = (d: number, minutes = 0) => new Date(NOW - d * 86_400_000 + minutes * 60_000).toISOString();
  const log = (field: string, next: unknown, at: string, result = "done") =>
    getDb().execute(sql`INSERT INTO audit_log (field, new, result, at) VALUES (${field}, ${JSON.stringify(next)}::jsonb, ${result}, ${at})`);
  const added = (...ids: string[]) => ({ added: ids, removed: [] });
  const names = new Map([["design needed", "LA_design"]]);

  beforeEach(async () => {
    await getDb().execute(sql`TRUNCATE audit_log RESTART IDENTITY CASCADE`);
  });

  it("counts adds from label and assignee edits, by label ID and lower-cased login", async () => {
    for (let i = 0; i < 3; i++) {
      await log("labels", added("LA_1"), daysAgo(i + 1));
      await log("assignees", added("Alice"), daysAgo(i + 1));
    }
    expect(await frequentChoices(names, NOW)).toEqual({ labels: ["LA_1"], assignees: ["alice"] });
  });

  it("removals, failed edits, other fields and adds older than the window do not count", async () => {
    for (let i = 0; i < 3; i++) {
      await log("labels", { added: [], removed: ["LA_removed"] }, daysAgo(i + 1));
      await log("labels", added("LA_failed"), daysAgo(i + 1), "failed");
      await log("priority", "LA_priority", daysAgo(i + 1));
      await log("labels", added("LA_old"), daysAgo(FREQUENT_DAYS + 1 + i));
    }
    expect(await frequentChoices(names, NOW)).toEqual({ labels: [], assignees: [] });
  });

  it("a created issue counts its labels (by name) and assignees; an unknown label name is skipped", async () => {
    for (let i = 0; i < 2; i++) await log("create", { title: "t", labelNames: ["Design needed", "deleted since"], assigneeLogins: ["bob"] }, daysAgo(i + 1));
    await log("labels", added("LA_design"), daysAgo(5));
    await log("assignees", added("bob"), daysAgo(5));
    expect(await frequentChoices(names, NOW)).toEqual({ labels: ["LA_design"], assignees: ["bob"] });
  });

  it("a bulk edit over many issues is one use", async () => {
    for (let i = 0; i < 10; i++) await log("labels", added("LA_bulk"), new Date(NOW - 86_400_000 + i * 1500).toISOString());
    expect((await frequentChoices(names, NOW)).labels).toEqual([]);
  });
});
