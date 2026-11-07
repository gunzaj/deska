// Release risk (IMPROVEMENTS F2): what in a Release is likely to slip. No
// burndown or velocity (SPEC §8 non-goal): two plain rules (the predecessor's
// "no linked PR" rule went with PRs in D6).
import type { ClientIssue, ClientMeta, ClientRelease } from "./types";

export type ReleaseRisk = {
  /** The top Priority option (highest rank), or null when the project has none. */
  topPriorityId: string | null;
  /** Open top-priority issues with nobody assigned. */
  noOwner: ClientIssue[];
  /** Issues put into this Release after it started, still in it. */
  scopeAdded: ClientIssue[];
};

/** A Release is in progress from its start date up to (not including) its exclusive end date. */
export function inProgress(r: Pick<ClientRelease, "startDate" | "endDate">, today: string): boolean {
  return today >= r.startDate && today < r.endDate;
}

export function releaseRisk(opts: {
  issues: ClientIssue[];
  release: ClientRelease;
  meta: Pick<ClientMeta, "fields" | "today">;
  /** Node IDs F0 saw set to this Release on or after its start. */
  scopeAddedIds: Iterable<string>;
}): ReleaseRisk {
  const { issues, release, meta } = opts;
  const topPriorityId = meta.fields.priority.at(-1)?.id ?? null;
  const inRelease = issues.filter((i) => i.releaseId === release.id);
  const top = inRelease.filter((i) => i.state === "open" && topPriorityId != null && i.priorityId === topPriorityId);
  const added = new Set(opts.scopeAddedIds);
  return {
    topPriorityId,
    noOwner: top.filter((i) => !i.assignees.length),
    scopeAdded: inRelease.filter((i) => added.has(i.nodeId)),
  };
}
