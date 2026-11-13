// "Suggest for this queue" (SPEC §4.9): one batch takes at most what the route
// accepts. A longer queue used to be sent whole and refused.
import { describe, expect, it } from "vitest";
import { QUEUE_MAX, queueBatch } from "@/components/triage/queue-ai";

describe("the queue batch", () => {
  it("sends a short queue whole and a long one's first 200", () => {
    expect(queueBatch([3, 1, 2])).toEqual([3, 1, 2]);
    const long = Array.from({ length: 250 }, (_, i) => i + 1);
    expect(queueBatch(long)).toHaveLength(QUEUE_MAX);
    expect(queueBatch(long)[0]).toBe(1);
    expect(queueBatch(long).at(-1)).toBe(200);
  });
});
