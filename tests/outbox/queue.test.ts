import { describe, expect, it } from "vitest";
import { needsBulkConfirm } from "@/lib/outbox/queue";

describe("bulk edit confirmation", () => {
  it("requires confirmation for bulk edits over 50", () => {
    expect(needsBulkConfirm(50)).toBe(false);
    expect(needsBulkConfirm(51)).toBe(true);
  });
});
