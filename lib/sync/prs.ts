// Pull request helpers shared by the stores and the GitHub source (SPEC §13).
import type { SnapshotPullRequest } from "./types";

/** Order-free form of a PR snapshot, so set order never counts as a change. */
export function normalizePullRequest(p: SnapshotPullRequest): SnapshotPullRequest {
  return {
    ...p,
    labelIds: [...new Set(p.labelIds)].sort(),
    assigneeIds: [...new Set(p.assigneeIds)].sort(),
    reviewRequests: [...p.reviewRequests].sort((a, b) => `${a.kind}:${a.reviewer}`.localeCompare(`${b.kind}:${b.reviewer}`)),
    reviews: [...p.reviews].sort((a, b) => a.author.localeCompare(b.author)),
    closingIssueNodeIds: [...new Set(p.closingIssueNodeIds)].sort(),
  };
}
