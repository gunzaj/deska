// SPEC §4.9: starting jobs never leaves an orphan. When the readiness check
// throws (settings unreadable), no job is queued; a batch starts all its jobs
// or none, so a failed start answered with 503 has nothing running behind it.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod/v4";
import type { AiTask } from "@/lib/ai/prompt";

const settings = vi.hoisted(() => ({ fail: false }));
vi.mock("@/lib/settings", () => ({
  readAiSettings: async () => {
    if (settings.fail) throw new Error("database unavailable");
    return { provider: "off" };
  },
  readAiVerified: async () => null,
}));

const { activeJobs, resetJobs, startJob, startJobs } = await import("@/lib/ai/runner");

const task = (subject: string): AiTask => ({
  feature: "issue-triage",
  subjectKind: "issue",
  subject,
  subjectVersion: "2026-01-01T00:00:00Z",
  instructions: "Suggest a status for the issue in the data block.",
  data: [{ label: "issue", text: "Title: Crash on save" }],
  schema: z.object({ status: z.string() }),
  schemaName: "triage",
});

beforeEach(() => {
  resetJobs();
  settings.fail = false;
});

describe("starting jobs", () => {
  it("a readiness check that throws leaves no queued job behind", async () => {
    settings.fail = true;
    await expect(startJob(task("1"))).rejects.toThrow("database unavailable");
    expect(activeJobs()).toEqual([]);
  });

  it("a batch is all or nothing: one failed check queues none of it", async () => {
    settings.fail = true;
    await expect(startJobs([task("1"), task("2"), task("3")], { batchId: "b1" })).rejects.toThrow();
    expect(activeJobs()).toEqual([]);
  });

  it("a batch shares one id and one readiness answer", async () => {
    const jobs = await startJobs([task("1"), task("2")], { batchId: "b2" });
    expect(jobs.map((j) => [j.batchId, j.state, j.error?.code])).toEqual([
      ["b2", "error", "off"],
      ["b2", "error", "off"],
    ]);
  });
});
