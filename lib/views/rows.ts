import { priorityLowToHigh } from "../sync/field-map";
import type { ReadModel } from "../sync/read-model";

/** A dimension value on a row (§4.1): the option ID, its name and its place in the field's option order. */
export type DimValue = { id: string; name: string | null; rank: number | null };

/** Enriched row the view engine runs against (IDs, never display names). */
export type ViewRow = {
  nodeId: string;
  number: number;
  title: string;
  state: string;
  /** GitHub's close reason (`completed`, `not_planned`, `duplicate`); null while open or unknown. */
  stateReason: string | null;
  authorLogin: string;
  /** The issue has an item in the pinned project (its fields may all be empty). */
  inProject: boolean;
  statusId: string | null;
  statusName: string | null;
  statusRank: number | null;
  priorityId: string | null;
  /** Higher is more important, whichever way round the project orders the options (§4.1). */
  priorityRank: number | null;
  priorityName: string | null;
  /** Values of the mapped dimensions, by field ID; a dimension without a value is absent. */
  dims: Record<string, DimValue>;
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
  /** GitHub's sub-issue counts (§4.4); null until read. */
  subTotal: number | null;
  subCompleted: number | null;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
};

/** Every issue as a row, or with `onlyNodeId` just that one (a board move needs one card, not 3k rows). */
export function buildViewRows(store: ReadModel, onlyNodeId?: string): ViewRow[] {
  // Fields are resolved by ID through the mapping, never by name (§4.1).
  const map = store.projectFieldMap();
  const optionsOf = (id: string | undefined) => (id ? (store.fields.get(id)?.options ?? []) : []);
  // Option positions are the project's intended order. Sorting a single-select
  // by its raw ID produces an order that looks random to the user.
  const lookup = (options: readonly { id: string; name: string }[]) => new Map(options.map((o, i) => [o.id, { name: o.name, rank: i }]));
  const status = lookup(optionsOf(map.status?.id));
  // Priority rank: higher is more important, per the highest/lowest-first setting.
  const priority = lookup(priorityLowToHigh(optionsOf(map.priority?.id), map.priorityOrder));
  const dims = map.dimensions.map((d) => ({ id: d.id, options: lookup(optionsOf(d.id)) }));
  // Iterations sort chronologically by start date.
  const sprintField = map.sprint ? store.fields.get(map.sprint.id) : undefined;
  const iterationPos = new Map<string, { name: string; rank: number }>();
  [...(sprintField?.iterations ?? [])]
    .sort((a, b) => a.startDate.localeCompare(b.startDate))
    .forEach((it, i) => iterationPos.set(it.id, { name: it.title, rank: i }));

  const children = new Set<string>();
  for (const i of store.issues.values()) if (i.parentNodeId) children.add(i.parentNodeId);
  const source = onlyNodeId === undefined ? [...store.issues.values()] : [store.issues.get(onlyNodeId)].filter((i): i is NonNullable<typeof i> => i != null);
  return source.map((i) => {
    const piv = store.itemForIssue(i.nodeId);
    const statusId = piv?.statusOpt ?? null;
    const priorityId = piv?.priorityOpt ?? null;
    const releaseId = piv?.releaseIter ?? null;
    const rowDims: Record<string, DimValue> = {};
    for (const d of dims) {
      const v = piv?.dims?.[d.id];
      if (v) rowDims[d.id] = { id: v, name: d.options.get(v)?.name ?? null, rank: d.options.get(v)?.rank ?? null };
    }
    const parent = i.parentNodeId ? store.issues.get(i.parentNodeId) : undefined;
    return {
      nodeId: i.nodeId,
      number: i.number,
      title: i.title,
      state: i.state,
      stateReason: i.stateReason,
      authorLogin: i.authorLogin,
      inProject: piv != null,
      statusId,
      statusName: statusId ? (status.get(statusId)?.name ?? null) : null,
      statusRank: statusId ? (status.get(statusId)?.rank ?? null) : null,
      priorityId,
      priorityRank: priorityId ? (priority.get(priorityId)?.rank ?? null) : null,
      priorityName: priorityId ? (priority.get(priorityId)?.name ?? null) : null,
      dims: rowDims,
      releaseId,
      releaseName: releaseId ? (iterationPos.get(releaseId)?.name ?? null) : null,
      releaseRank: releaseId ? (iterationPos.get(releaseId)?.rank ?? null) : null,
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
      hasSubIssues: i.subTotal != null ? i.subTotal > 0 : children.has(i.nodeId),
      subTotal: i.subTotal,
      subCompleted: i.subCompleted,
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
  const releaseId = store.projectFieldMap().sprint?.id;
  const releaseField = releaseId ? store.fields.get(releaseId) : undefined;
  for (const it of releaseField?.iterations ?? []) {
    iters.push({ id: it.id, start: it.startDate, duration: it.duration });
  }
  iters.sort((a, b) => a.start.localeCompare(b.start));
  const t = new Date(todayIso).getTime();
  const endOf = (s: string, d: number) => new Date(s).getTime() + d * 86400_000;
  const idx = iters.findIndex((it) => new Date(it.start).getTime() <= t && t < endOf(it.start, it.duration));
  // On a day outside every iteration there is no current one; next and previous go by date (§4.1).
  if (idx === -1) {
    if (which === "current") return null;
    if (which === "next") return iters.find((it) => new Date(it.start).getTime() > t)?.id ?? null;
    return [...iters].reverse().find((it) => endOf(it.start, it.duration) <= t)?.id ?? null;
  }
  if (which === "current") return iters[idx]!.id;
  if (which === "next") return iters[idx + 1]?.id ?? null;
  return iters[idx - 1]?.id ?? null;
}
