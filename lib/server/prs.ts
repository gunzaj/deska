import type { ClientPr, PrData } from "@/lib/client/types";
import type { ReadModel } from "@/lib/sync/read-model";

/** The teams `viewer` is in: the only part of the PR payload that depends on who is asking. */
export function teamsOf(store: ReadModel, viewer: string): string[] {
  const me = viewer.toLowerCase();
  return [...store.teams.entries()].filter(([, members]) => members.includes(me)).map(([slug]) => slug);
}

/** PRs for the lens, with names resolved for the browser (SPEC §13.3). Viewer-independent. */
export function buildPrs(store: ReadModel): ClientPr[] {
  const login = (id: string) => store.ghUsers.get(id)?.login ?? id;
  return [...store.pullRequests.values()]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map((p) => ({
      nodeId: p.nodeId,
      number: p.number,
      title: p.title,
      state: p.state,
      isDraft: p.isDraft,
      author: p.authorLogin.toLowerCase(),
      url: p.url,
      headRef: p.headRef,
      baseRef: p.baseRef,
      reviewDecision: p.reviewDecision,
      checksState: p.checksState,
      milestoneId: p.milestoneId,
      additions: p.additions,
      deletions: p.deletions,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      closedAt: p.closedAt,
      mergedAt: p.mergedAt,
      labelIds: p.labelIds,
      assignees: p.assigneeIds.map(login).map((l) => l.toLowerCase()),
      reviewRequests: p.reviewRequests,
      reviews: p.reviews,
      closingIssues: p.closingIssueNodeIds,
    }));
}

export function buildPrData(store: ReadModel, viewer: string): PrData {
  return { prs: buildPrs(store), myTeams: teamsOf(store, viewer) };
}

/** The `prs` array, serialized once per store (one per cache generation) and reused for every viewer (v5 3.7). */
const serialized = new WeakMap<ReadModel, string>();
export function prsJson(store: ReadModel): string {
  let json = serialized.get(store);
  if (json === undefined) {
    json = JSON.stringify(buildPrs(store));
    serialized.set(store, json);
  }
  return json;
}

/** The `/api/prs` body: the shared, cached `prs` plus this viewer's teams. */
export function prDataJson(store: ReadModel, viewer: string): string {
  return `{"prs":${prsJson(store)},"myTeams":${JSON.stringify(teamsOf(store, viewer))}}`;
}
