import type { ReadModel } from "../sync/read-model";

/** Enriched row the view engine runs against (IDs, never display names). */
export type ViewRow = {
  nodeId: string;
  number: number;
  title: string;
  state: string;
  statusId: string | null;
  statusName: string | null;
  statusRank: number | null;
  priorityId: string | null;
  priorityRank: number | null;
  priorityName: string | null;
  teamId: string | null;
  teamName: string | null;
  teamRank: number | null;
  platformId: string | null;
  platformName: string | null;
  platformRank: number | null;
  releaseId: string | null;
  releaseName: string | null;
  releaseRank: number | null;
  typeId: string | null;
  typeName: string | null;
  labelIds: string[];
  labelNames: string[];
  milestoneId: string | null;
  milestoneName: string | null;
  assignees: string[];
  parentNodeId: string | null;
  parentNumber: number | null;
  parentTitle: string | null;
  hasSubIssues: boolean;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
};

type SingleSelectField = "status" | "priority" | "team" | "platform";

/** Every issue as a row, or with `onlyNodeId` just that one (a board move needs one card, not 3k rows). */
export function buildViewRows(store: ReadModel, onlyNodeId?: string): ViewRow[] {
  // Option positions are the team's intended order. Sorting a single-select by
  // its raw ID (which is what sortKey used to fall back to) produces an order
  // that looks random to the user.
  const optionPos = new Map<string, number>();
  for (const f of store.fields.values()) {
    for (const [i, o] of f.options.entries()) optionPos.set(o.id, i);
  }
  // Iterations sort chronologically by start date.
  const iterationPos = new Map<string, number>();
  const iterations: { id: string; start: string }[] = [];
  for (const f of store.fields.values()) {
    for (const it of f.iterations) iterations.push({ id: it.id, start: it.startDate });
  }
  iterations
    .sort((a, b) => a.start.localeCompare(b.start))
    .forEach((it, i) => iterationPos.set(it.id, i));

  // Fields are resolved by ID through the discovered map, never by name (v5 1.3).
  const map = store.projectFieldMap();
  const optionName = (key: SingleSelectField, optionId: string | null): string | null => {
    if (!optionId) return null;
    const f = map[key] ? store.fields.get(map[key]!.id) : undefined;
    return f?.options.find((x) => x.id === optionId)?.name ?? null;
  };
  const iterationName = (iterId: string | null): string | null => {
    if (!iterId) return null;
    for (const f of store.fields.values()) {
      const it = f.iterations.find((x) => x.id === iterId);
      if (it) return it.title;
    }
    return null;
  };
  const itemByIssue = new Map<string, { statusOpt: string | null; priorityOpt: string | null; teamOpt: string | null; platformOpt: string | null; releaseIter: string | null }>();
  const items = onlyNodeId === undefined ? store.projectItems.values() : [store.itemForIssue(onlyNodeId)].filter((p): p is NonNullable<typeof p> => p != null);
  for (const p of items) {
    itemByIssue.set(p.issueNodeId, {
      statusOpt: p.statusOpt,
      priorityOpt: p.priorityOpt,
      teamOpt: p.teamOpt,
      platformOpt: p.platformOpt,
      releaseIter: p.releaseIter,
    });
  }
  const children = new Set<string>();
  for (const i of store.issues.values()) if (i.parentNodeId) children.add(i.parentNodeId);
  const rank = (map: Map<string, number>, id: string | null): number | null =>
    id == null ? null : (map.get(id) ?? null);
  const source = onlyNodeId === undefined ? [...store.issues.values()] : [store.issues.get(onlyNodeId)].filter((i): i is NonNullable<typeof i> => i != null);
  return source.map((i) => {
    const piv = itemByIssue.get(i.nodeId);
    const priorityId = piv?.priorityOpt ?? null;
    const parent = i.parentNodeId ? store.issues.get(i.parentNodeId) : undefined;
    return {
      nodeId: i.nodeId,
      number: i.number,
      title: i.title,
      state: i.state,
      statusId: piv?.statusOpt ?? null,
      statusName: optionName("status", piv?.statusOpt ?? null),
      statusRank: rank(optionPos, piv?.statusOpt ?? null),
      priorityId,
      priorityRank: rank(optionPos, priorityId),
      priorityName: optionName("priority", priorityId),
      teamId: piv?.teamOpt ?? null,
      teamName: optionName("team", piv?.teamOpt ?? null),
      teamRank: rank(optionPos, piv?.teamOpt ?? null),
      platformId: piv?.platformOpt ?? null,
      platformName: optionName("platform", piv?.platformOpt ?? null),
      platformRank: rank(optionPos, piv?.platformOpt ?? null),
      releaseId: piv?.releaseIter ?? null,
      releaseName: iterationName(piv?.releaseIter ?? null),
      releaseRank: rank(iterationPos, piv?.releaseIter ?? null),
      typeId: i.typeId,
      typeName: i.typeId ? (store.issueTypes.get(i.typeId)?.name ?? null) : null,
      labelIds: [...i.labelIds],
      labelNames: i.labelIds.map((id) => store.labels.get(id)?.name ?? id),
      milestoneId: i.milestoneId,
      milestoneName: i.milestoneId ? (store.milestones.get(i.milestoneId)?.title ?? null) : null,
      assignees: i.assigneeIds.map((id) => store.ghUsers.get(id)?.login ?? id),
      parentNodeId: i.parentNodeId,
      parentNumber: parent?.number ?? null,
      parentTitle: parent?.title ?? null,
      hasSubIssues: children.has(i.nodeId),
      createdAt: i.createdAt,
      updatedAt: i.updatedAt,
      closedAt: i.closedAt,
    };
  });
}

/** Resolve current/next/previous iteration IDs by date. */
export function resolveRelease(
  store: ReadModel,
  which: "current" | "next" | "previous",
  todayIso: string,
): string | null {
  const iters: { id: string; start: string; duration: number }[] = [];
  const releaseId = store.projectFieldMap().release?.id;
  const releaseField = releaseId ? store.fields.get(releaseId) : undefined;
  for (const it of releaseField?.iterations ?? []) {
    iters.push({ id: it.id, start: it.startDate, duration: it.duration });
  }
  iters.sort((a, b) => a.start.localeCompare(b.start));
  const t = new Date(todayIso).getTime();
  const endOf = (s: string, d: number) => new Date(s).getTime() + d * 86400_000;
  const idx = iters.findIndex((it) => new Date(it.start).getTime() <= t && t < endOf(it.start, it.duration));
  if (idx === -1) return null;
  if (which === "current") return iters[idx]!.id;
  if (which === "next") return iters[idx + 1]?.id ?? null;
  return iters[idx - 1]?.id ?? null;
}
