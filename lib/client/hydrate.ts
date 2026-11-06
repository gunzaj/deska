import { fallbackIssueUrl } from "../github/url";
import type { ClientData, ClientIssue, ClientMeta, WireData, WireIssue } from "./types";

/**
 * Rows already built, by the wire row they came from (v5 3.3, 3.4). A row's
 * names, ranks and URL depend on the metadata lookups and, for the parent
 * title and sub-issue counts, on other rows; both are checked before a cached
 * row is reused, so a reused row is always the one a rebuild would produce.
 * One slot: there is one app per page.
 */
let cache: { meta: string; rows: WeakMap<WireIssue, ClientIssue> } | null = null;

function metaKey(meta: ClientMeta): string {
  return JSON.stringify([meta.repo, meta.fields, meta.releases, meta.issueTypes, meta.labels, meta.milestones]);
}

/** Rebuild full rows (names, ranks, parent titles, sub-issue counts) from the wire format. */
export function hydrate(data: WireData): ClientData {
  const { meta } = data;
  const key = metaKey(meta);
  if (!cache || cache.meta !== key) cache = { meta: key, rows: new WeakMap() };
  const rows = cache.rows;
  const opt = new Map<string, { name: string; rank: number }>();
  for (const list of Object.values(meta.fields)) {
    for (const o of list) opt.set(o.id, { name: o.name, rank: o.position });
  }
  const rel = new Map(meta.releases.map((r, i) => [r.id, { name: r.title, rank: i }]));
  const types = new Map(meta.issueTypes.map((t) => [t.id, t.name]));
  const labels = new Map(meta.labels.map((l) => [l.id, l.name]));
  const milestones = new Map(meta.milestones.map((m) => [m.id, m.title]));
  const byId = new Map(data.issues.map((w) => [w.id, w]));
  const subTotal = new Map<string, number>();
  const subClosed = new Map<string, number>();
  for (const w of data.issues) {
    if (!w.pa) continue;
    subTotal.set(w.pa, (subTotal.get(w.pa) ?? 0) + 1);
    if (!w.o) subClosed.set(w.pa, (subClosed.get(w.pa) ?? 0) + 1);
  }
  const [owner, repo] = meta.repo.split("/");

  const issues: ClientIssue[] = data.issues.map((w) => {
    const parent = w.pa ? byId.get(w.pa) : undefined;
    const hit = rows.get(w);
    if (
      hit &&
      hit.parentNumber === (parent?.n ?? null) &&
      hit.parentTitle === (parent?.t ?? null) &&
      hit.subTotal === (subTotal.get(w.id) ?? 0) &&
      hit.subClosed === (subClosed.get(w.id) ?? 0)
    ) {
      return hit;
    }
    const o = (id?: string) => (id ? opt.get(id) : undefined);
    const lb = w.lb ?? [];
    const row: ClientIssue = {
      nodeId: w.id,
      number: w.n,
      title: w.t,
      state: w.o ? "open" : "closed",
      stateReason: w.sr ?? null,
      statusId: w.st ?? null,
      statusName: o(w.st)?.name ?? null,
      statusRank: o(w.st)?.rank ?? null,
      priorityId: w.pr ?? null,
      priorityName: o(w.pr)?.name ?? null,
      priorityRank: o(w.pr)?.rank ?? null,
      teamId: w.tm ?? null,
      teamName: o(w.tm)?.name ?? null,
      teamRank: o(w.tm)?.rank ?? null,
      platformId: w.pl ?? null,
      platformName: o(w.pl)?.name ?? null,
      platformRank: o(w.pl)?.rank ?? null,
      releaseId: w.rl ?? null,
      releaseName: w.rl ? (rel.get(w.rl)?.name ?? null) : null,
      releaseRank: w.rl ? (rel.get(w.rl)?.rank ?? null) : null,
      typeId: w.ty ?? null,
      typeName: w.ty ? (types.get(w.ty) ?? null) : null,
      labelIds: lb,
      labelNames: lb.map((id) => labels.get(id) ?? id),
      milestoneId: w.ms ?? null,
      milestoneName: w.ms ? (milestones.get(w.ms) ?? null) : null,
      assignees: w.as ?? [],
      parentNodeId: w.pa ?? null,
      parentNumber: parent?.n ?? null,
      parentTitle: parent?.t ?? null,
      hasSubIssues: subTotal.has(w.id),
      createdAt: w.c,
      updatedAt: w.u,
      url: w.gh ?? fallbackIssueUrl(`${owner}/${repo}`, w.n),
      authorLogin: w.au,
      closedAt: w.cl ?? null,
      subTotal: subTotal.get(w.id) ?? 0,
      subClosed: subClosed.get(w.id) ?? 0,
    };
    rows.set(w, row);
    return row;
  });
  return { meta, issues };
}
