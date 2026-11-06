// Release risk (IMPROVEMENTS F2): what in a Release is likely to slip. No
// burndown or velocity (SPEC §8 non-goal): three plain rules.
import { daysBetween } from "./format";
import type { ClientIssue, ClientMeta, ClientRelease } from "./types";

export type ReleaseRisk = {
  /** The top Priority option (highest rank), or null when the project has none. */
  topPriorityId: string | null;
  /** Open top-priority issues with nobody assigned. */
  noOwner: ClientIssue[];
  /** Open top-priority issues with no open PR linked, once 7 days or fewer are left. Null before that. */
  noPr: ClientIssue[] | null;
  /** Issues put into this Release after it started, still in it. */
  scopeAdded: ClientIssue[];
};

/** Days left that switch the "no linked PR" rule on. */
export const NO_PR_DAYS = 7;

/** A Release is in progress from its start date up to (not including) its exclusive end date. */
export function inProgress(r: Pick<ClientRelease, "startDate" | "endDate">, today: string): boolean {
  return today >= r.startDate && today < r.endDate;
}

export function releaseRisk(opts: {
  issues: ClientIssue[];
  release: ClientRelease;
  meta: Pick<ClientMeta, "fields" | "today">;
  /** Open PRs that close an issue (by node ID); anything else counts as no PR. */
  hasOpenPr: (issueNodeId: string) => boolean;
  /** Node IDs F0 saw set to this Release on or after its start. */
  scopeAddedIds: Iterable<string>;
}): ReleaseRisk {
  const { issues, release, meta } = opts;
  const topPriorityId = meta.fields.priority.at(-1)?.id ?? null;
  const inRelease = issues.filter((i) => i.releaseId === release.id);
  const top = inRelease.filter((i) => i.state === "open" && topPriorityId != null && i.priorityId === topPriorityId);
  const left = daysBetween(meta.today, release.endDate);
  const added = new Set(opts.scopeAddedIds);
  return {
    topPriorityId,
    noOwner: top.filter((i) => !i.assignees.length),
    noPr: inProgress(release, meta.today) && left <= NO_PR_DAYS ? top.filter((i) => !opts.hasOpenPr(i.nodeId)) : null,
    scopeAdded: inRelease.filter((i) => added.has(i.nodeId)),
  };
}
