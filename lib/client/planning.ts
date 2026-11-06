// Release planning (IMPROVEMENTS F1): load per Release by the first mapped
// dimension (e.g. a team field) and by person, and
// what is left over from Releases that have ended. Pure, so the counts can be
// tested against the explorer filtered the same way.
import { primaryDimension } from "./explorer";
import type { ClientIssue, ClientMeta, ClientRelease } from "./types";

export type LoadRow = { key: string; label: string; open: number; closed: number };

export type ReleaseLoad = {
  release: ClientRelease;
  total: number;
  open: number;
  closed: number;
  /** By the first mapped dimension; empty without one. */
  byDim: LoadRow[];
  byAssignee: LoadRow[];
  /** Open issues nobody is assigned to. */
  unassigned: number;
};

const NO_VALUE = "__none";

function bump(map: Map<string, LoadRow>, key: string, label: string, closed: boolean) {
  const row = map.get(key) ?? { key, label, open: 0, closed: 0 };
  row[closed ? "closed" : "open"] += 1;
  map.set(key, row);
}

const bySize = (a: LoadRow, b: LoadRow) => b.open + b.closed - (a.open + a.closed) || a.label.localeCompare(b.label);

/** Issues in `release`: counts by the first dimension and by assignee (an issue with two assignees counts for both). */
export function releaseLoad(issues: ClientIssue[], release: ClientRelease, meta: Pick<ClientMeta, "dimensions">): ReleaseLoad {
  const dim = primaryDimension(meta);
  const byDim = new Map<string, LoadRow>();
  const people = new Map<string, LoadRow>();
  let open = 0;
  let closed = 0;
  let unassigned = 0;
  for (const i of issues) {
    if (i.releaseId !== release.id) continue;
    const isClosed = i.state === "closed";
    if (isClosed) closed += 1;
    else open += 1;
    if (dim) {
      const v = i.dims[dim.id];
      bump(byDim, v?.id ?? NO_VALUE, v ? (dim.options.find((o) => o.id === v.id)?.name ?? "Missing option") : `No ${dim.name}`, isClosed);
    }
    if (i.assignees.length) for (const a of i.assignees) bump(people, a.toLowerCase(), a, isClosed);
    else if (!isClosed) unassigned += 1;
  }
  return { release, total: open + closed, open, closed, byDim: [...byDim.values()].sort(bySize), byAssignee: [...people.values()].sort(bySize), unassigned };
}

/** A Release has ended once its (exclusive) end date is today or earlier: its last day is before today. */
export function hasEnded(release: Pick<ClientRelease, "endDate">, today: string): boolean {
  return release.endDate <= today;
}

/**
 * Open issues still in a Release that has ended, most recent Release first,
 * then by Priority rank (highest first). `today` is the viewer's date.
 */
export function carryOver(issues: ClientIssue[], meta: Pick<ClientMeta, "releases" | "today" | "fields">): ClientIssue[] {
  const ended = new Map(meta.releases.filter((r) => hasEnded(r, meta.today)).map((r) => [r.id, r]));
  const rank = new Map(meta.fields.priority.map((p, n) => [p.id, n]));
  return issues
    .filter((i) => i.state === "open" && i.releaseId != null && ended.has(i.releaseId))
    .sort(
      (a, b) =>
        ended.get(b.releaseId!)!.endDate.localeCompare(ended.get(a.releaseId!)!.endDate) ||
        (rank.get(b.priorityId ?? "") ?? -1) - (rank.get(a.priorityId ?? "") ?? -1) ||
        a.number - b.number,
    );
}

/** A GitHub issue search for these issues, to paste into GitHub when Deska can't write. */
export function githubSearch(repo: string, numbers: number[]): string {
  return `repo:${repo} is:issue is:open (${numbers.map((n) => `#${n}`).join(" OR ")})`;
}

export function githubSearchUrl(repo: string, numbers: number[]): string {
  return `https://github.com/${repo}/issues?q=${encodeURIComponent(githubSearch(repo, numbers))}`;
}
