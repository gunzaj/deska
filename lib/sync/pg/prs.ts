// Batched writes for pull requests and team membership.
import { createHash } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { ghTeamMembers, prAssignees, prIssueLinks, prLabels, prReviewRequests, prReviews, pullRequests } from "@/db/schema";
import type { StoreStats } from "../import";
import { normalizePullRequest } from "../prs";
import type { FullSnapshot, SnapshotPullRequest } from "../types";
import { type Tx, add, changed, diffChildren, emptyStats, excludedSet, insertedFlag, lastByKey, tallyUpsert } from "./sql-helpers";

// --- pull requests -------------------------------------------------------

export const PR_PROPS = [
  "number",
  "title",
  "state",
  "isDraft",
  "authorLogin",
  "url",
  "headRef",
  "baseRef",
  "reviewDecision",
  "checksState",
  "milestoneId",
  "additions",
  "deletions",
  "createdAt",
  "updatedAt",
  "closedAt",
  "mergedAt",
  "fingerprint",
  "deleted",
  "deletedReason",
];

export function prFingerprint(pr: SnapshotPullRequest): string {
  return createHash("sha256").update(JSON.stringify(normalizePullRequest(pr))).digest("hex");
}

/**
 * A page of PRs. The normalised snapshot's hash is stored with the row, so an
 * unchanged PR costs part of one SELECT and no writes; only changed PRs are
 * upserted and have their child rows diffed, all in one transaction.
 */
export async function importPrPage(tx: Tx, page: SnapshotPullRequest[]): Promise<StoreStats> {
  const list = lastByKey(page, (p) => p.nodeId).map((p) => ({ pr: normalizePullRequest(p), fingerprint: prFingerprint(p) }));
  const prev = await tx
    .select({ nodeId: pullRequests.ghNodeId, fingerprint: pullRequests.fingerprint, deleted: pullRequests.deleted })
    .from(pullRequests)
    .where(
      inArray(
        pullRequests.ghNodeId,
        list.map((x) => x.pr.nodeId),
      ),
    );
  // A row marked deleted that GitHub reports again must be revived.
  const known = new Map(prev.map((r) => [r.nodeId, r.deleted ? null : r.fingerprint]));
  const changedPrs = list.filter((x) => known.get(x.pr.nodeId) !== x.fingerprint);
  const stats: StoreStats = { inserted: 0, updated: 0, unchanged: list.length - changedPrs.length };
  if (!changedPrs.length) return stats;

  // A PR without `body` (never from GitHub, but the type allows it) keeps the stored one.
  const ret: { id: string; nodeId: string; inserted: boolean }[] = [];
  for (const withBody of [true, false]) {
    const group = changedPrs.filter((x) => (x.pr.body !== undefined) === withBody);
    if (!group.length) continue;
    const props = withBody ? [...PR_PROPS, "body"] : PR_PROPS;
    ret.push(
      ...(await tx
        .insert(pullRequests)
        .values(
          group.map(({ pr, fingerprint }) => ({
            ghNodeId: pr.nodeId,
            number: pr.number,
            title: pr.title,
            body: pr.body ?? null,
            state: pr.state,
            isDraft: pr.isDraft,
            authorLogin: pr.authorLogin,
            url: pr.url,
            headRef: pr.headRef,
            baseRef: pr.baseRef,
            reviewDecision: pr.reviewDecision,
            checksState: pr.checksState,
            milestoneId: pr.milestoneId,
            additions: pr.additions,
            deletions: pr.deletions,
            createdAt: new Date(pr.createdAt),
            updatedAt: new Date(pr.updatedAt),
            closedAt: pr.closedAt ? new Date(pr.closedAt) : null,
            mergedAt: pr.mergedAt ? new Date(pr.mergedAt) : null,
            fingerprint,
            syncedAt: new Date(),
            deleted: false,
            deletedReason: null,
          })),
        )
        .onConflictDoUpdate({
          target: pullRequests.ghNodeId,
          set: { ...excludedSet(pullRequests, props), syncedAt: sql`excluded.synced_at` },
          setWhere: changed(pullRequests, props),
        })
        .returning({ id: pullRequests.id, nodeId: pullRequests.ghNodeId, inserted: insertedFlag })),
    );
  }
  add(stats, tallyUpsert(changedPrs.length, ret));

  const idOf = new Map(ret.map((r) => [r.nodeId, r.id]));
  const owners = [...idOf.values()];
  const rowsFor = <T>(f: (pr: SnapshotPullRequest, prId: string) => T[]) => changedPrs.flatMap(({ pr }) => (idOf.has(pr.nodeId) ? f(pr, idOf.get(pr.nodeId)!) : []));
  await diffChildren(
    tx,
    prLabels,
    "prId",
    ["prId", "labelId"],
    owners,
    rowsFor((pr, prId) => pr.labelIds.map((labelId) => ({ prId, labelId }))),
  );
  await diffChildren(
    tx,
    prAssignees,
    "prId",
    ["prId", "ghUserId"],
    owners,
    rowsFor((pr, prId) => pr.assigneeIds.map((ghUserId) => ({ prId, ghUserId }))),
  );
  await diffChildren(
    tx,
    prReviewRequests,
    "prId",
    ["prId", "reviewerKind", "reviewer"],
    owners,
    rowsFor((pr, prId) => lastByKey(pr.reviewRequests, (r) => `${r.kind}:${r.reviewer}`).map((r) => ({ prId, reviewerKind: r.kind, reviewer: r.reviewer }))),
  );
  await diffChildren(
    tx,
    prReviews,
    "prId",
    ["prId", "authorLogin"],
    owners,
    rowsFor((pr, prId) =>
      lastByKey(pr.reviews, (r) => r.author).map((r) => ({ prId, authorLogin: r.author, state: r.state, submittedAt: r.submittedAt ? new Date(r.submittedAt) : null })),
    ),
  );
  await diffChildren(
    tx,
    prIssueLinks,
    "prId",
    ["prId", "issueNodeId"],
    owners,
    rowsFor((pr, prId) => pr.closingIssueNodeIds.map((issueNodeId) => ({ prId, issueNodeId }))),
  );
  return stats;
}

export async function setTeams(tx: Tx, teams: NonNullable<FullSnapshot["teams"]>): Promise<StoreStats> {
  const stats = emptyStats();
  for (const t of lastByKey(teams, (x) => x.slug)) {
    const next = [...new Set(t.members.map((m) => m.toLowerCase()))].sort();
    const current = (await tx.select({ login: ghTeamMembers.login }).from(ghTeamMembers).where(eq(ghTeamMembers.teamSlug, t.slug))).map((r) => r.login).sort();
    if (current.length === next.length && current.every((v, i) => v === next[i])) {
      stats.unchanged += 1;
      continue;
    }
    const keep = new Set(next);
    const gone = current.filter((l) => !keep.has(l));
    if (gone.length) await tx.delete(ghTeamMembers).where(and(eq(ghTeamMembers.teamSlug, t.slug), inArray(ghTeamMembers.login, gone)));
    const have = new Set(current);
    const fresh = next.filter((l) => !have.has(l));
    if (fresh.length) await tx.insert(ghTeamMembers).values(fresh.map((login) => ({ teamSlug: t.slug, login }))).onConflictDoNothing();
    stats[current.length ? "updated" : "inserted"] += 1;
  }
  return stats;
}
