// W1: accepting an AI triage suggestion goes through the §4.8 outbox like a
// manual edit (SPEC §4.9). Runs on an in-memory PGlite database.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";

vi.mock("@/lib/session", () => ({ getViewerLogin: async () => "alice" }));

describe("accepting an AI suggestion (W1)", async () => {
  const { getDb } = await import("@/db");
  const { fixtureSnapshot } = await import("../fixtures/github");
  const { importFull } = await import("@/lib/sync/import");
  const { PostgresStore } = await import("@/lib/sync/store-postgres");
  const { getStore, invalidateReadCache } = await import("@/lib/store");
  const { saveMapping, resetSettingsCache } = await import("@/lib/settings");
  const { setLocalToken } = await import("@/lib/github/local-token");
  const { saveResult, resultById } = await import("@/lib/ai/results");
  const { acceptTriageSuggestion } = await import("@/lib/ai/accept");
  const { triageInput } = await import("@/lib/ai/triage-service");

  const TOKEN = ["github", "pat", "ACCEPT", "FAKE", "0".repeat(24)].join("_");
  const fake = () => {
    const applied: string[] = [];
    const remote: Record<string, unknown> = { status: null, priority: null, release: null, labels: [] };
    return {
      applied,
      async readField(_n: string, field: string | null) {
        return remote[field ?? ""] ?? null;
      },
      async applyField(_n: string, field: string | null, next: unknown) {
        applied.push(`${field}=${JSON.stringify(next)}`);
        remote[field ?? ""] = next;
      },
      async closeIssue() {},
      async reopenIssue() {},
      async createIssue() {
        return { nodeId: "I_created", number: 999 };
      },
      async addProjectItem() {},
    };
  };

  const suggest = async () => {
    const input = (await triageInput(102))!;
    const first = <T,>(list: T[]): T => list[0]!;
    const result = {
      summary: "Triage this.",
      status: { id: first(input.choices.status!.options).id, reason: "Open work.", confidence: "medium" as const },
      priority: { id: first(input.choices.priority!.options).id, reason: "Important.", confidence: "high" as const },
      dimension: input.choices.dimension ? { id: first(input.choices.dimension.options).id, reason: "Team fits.", confidence: "low" as const } : null,
      sprint: input.choices.sprint ? { id: first(input.choices.sprint.options).id, reason: "Next sprint.", confidence: "medium" as const } : null,
      labels: input.repoLabels.length ? [{ id: input.repoLabels[0]!.id, reason: "UI affected.", confidence: "low" as const }] : [],
    };
    const id = await saveResult({ feature: "issue-triage", subjectKind: "issue", subject: "102", inputHash: "hash", provider: "claude-code", model: "sonnet", result, durationMs: 1, costUsd: null });
    return (await resultById(id!))!;
  };

  beforeEach(async () => {
    await getDb().execute(
      sql`TRUNCATE issues, issue_labels, issue_assignees, project_items, project_scan_seen, field_options, iterations, project_fields, labels, milestones, gh_users, issue_types, sync_state, ai_results RESTART IDENTITY CASCADE`,
    );
    await importFull(fixtureSnapshot(), new PostgresStore());
    invalidateReadCache();
    const store = await getStore();
    await saveMapping(store.projectFieldMap());
    invalidateReadCache();
    resetSettingsCache();
    setLocalToken(TOKEN, "launch");
  });

  it("applies the suggested Status, Priority, dimension, Sprint and labels through the outbox", async () => {
    const row = await suggest();
    const client = fake();
    const out = await acceptTriageSuggestion(row, { deps: (done) => ({ client, doneStatusOptionId: done }) });
    expect(out.applied).toEqual(["status", "priority", "dimension", "sprint", "labels"]);
    expect(client.applied).toEqual([
      expect.stringMatching(/^status="a00/),
      expect.stringMatching(/^priority="b00/),
      expect.stringMatching(/^dim:PVTSSF_acme_team="c00/),
      expect.stringMatching(/^release="e00/),
      expect.stringMatching(/^labels=\{"added":\["UI"\],"removed":\[\]\}$/),
    ]);
  });

  it("only applies the parts the user kept in the Edit dialog", async () => {
    const row = await suggest();
    const client = fake();
    const out = await acceptTriageSuggestion(row, { parts: ["priority"], deps: (done) => ({ client, doneStatusOptionId: done }) });
    expect(out.applied).toEqual(["priority"]);
    expect(out.unchanged).not.toContain("priority");
    expect(client.applied).toHaveLength(1);
  });

  it("a stale value is a conflict and nothing is written", async () => {
    const row = await suggest();
    const client = fake();
    client.readField = async () => "b0000003"; // changed on GitHub since the suggestion
    await expect(acceptTriageSuggestion(row, { parts: ["priority"], deps: (done) => ({ client, doneStatusOptionId: done }) })).rejects.toThrow(/Changed on GitHub/);
    expect(client.applied).toEqual([]);
  });
});
