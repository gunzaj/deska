// Which of a sprint's three groups an issue is in (§4.5). No imports, so the
// explorer's grouping and the sprint header can both use it.
import type { ClientIssue } from "./types";

export type SprintBucket = "remaining" | "done" | "notPlanned";

/** GitHub's "Closed as not planned" and "Closed as duplicate" both mean the work did not ship. */
const NOT_PLANNED = new Set(["not_planned", "duplicate"]);

export const BUCKET_LABEL: Record<SprintBucket, string> = {
  remaining: "Remaining",
  done: "Done",
  notPlanned: "Not planned",
};

/** Display order of the three groups. */
export const BUCKET_ORDER: SprintBucket[] = ["remaining", "done", "notPlanned"];

type BucketInput = Pick<ClientIssue, "state" | "stateReason" | "statusId">;

/**
 * Open = Remaining, unless its Status is one of the "also counts as done"
 * options. Closed as completed = Done. Closed as not planned = Not planned.
 */
export function sprintBucket(i: BucketInput, doneStatusIds: Iterable<string> = []): SprintBucket {
  if (i.state === "closed") return NOT_PLANNED.has((i.stateReason ?? "").toLowerCase()) ? "notPlanned" : "done";
  return i.statusId && new Set(doneStatusIds).has(i.statusId) ? "done" : "remaining";
}

