// Release notes draft (IMPROVEMENTS F5): the issues closed in a Release, as
// markdown grouped by issue Type. Pure and
// read-only: nothing is written anywhere, the page just copies the text.
import { formatDate, lastDay, plainName } from "./format";
import type { ClientIssue, ClientMeta, ClientRelease } from "./types";

const OTHER = "Other";

export type NotesInput = {
  release: ClientRelease;
  issues: ClientIssue[];
  meta: Pick<ClientMeta, "repo" | "issueTypes" | "labels">;
  /** Label IDs to sub-group by, in this order. Empty: no sub-groups. */
  labelSet?: string[];
};

/** Closed in the Release and not closed as "not planned" (those didn't ship). */
export function shippedIssues(issues: ClientIssue[], releaseId: string): ClientIssue[] {
  return issues.filter((i) => i.releaseId === releaseId && i.state === "closed" && i.stateReason?.toLowerCase() !== "not_planned");
}

/** Labels worth offering as a sub-group set: those on at least one shipped issue. */
export function labelsInUse(shipped: ClientIssue[], meta: Pick<ClientMeta, "labels">): { id: string; name: string; n: number }[] {
  const n = new Map<string, number>();
  for (const i of shipped) for (const id of i.labelIds) n.set(id, (n.get(id) ?? 0) + 1);
  return meta.labels.filter((l) => n.has(l.id)).map((l) => ({ id: l.id, name: l.name, n: n.get(l.id)! })).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
}

function line(issue: ClientIssue): string {
  return `- ${issue.title} ([#${issue.number}](${issue.url}))`;
}

export function releaseNotes({ release, issues, meta, labelSet = [] }: NotesInput): string {
  const shipped = shippedIssues(issues, release.id);

  const out = [`# Release ${release.title}`, "", `${formatDate(release.startDate)} – ${formatDate(lastDay(release.endDate))}`];
  if (!shipped.length) return [...out, "", "_Nothing closed in this Release yet._", ""].join("\n");

  const typeOrder = [...meta.issueTypes.map((t) => t.id), null];
  const typeName = (id: string | null) => (id ? (meta.issueTypes.find((t) => t.id === id)?.name ?? OTHER) : OTHER);
  const labelName = (id: string) => meta.labels.find((l) => l.id === id)?.name ?? id;
  for (const typeId of typeOrder) {
    const inType = shipped.filter((i) => (i.typeId ?? null) === typeId).sort((a, b) => a.number - b.number);
    if (!inType.length) continue;
    out.push("", `## ${plainName(typeName(typeId)) || typeName(typeId)}`, "");
    if (!labelSet.length) {
      out.push(...inType.map((i) => line(i)));
      continue;
    }
    // An issue goes under the first label of the set it carries, so nothing is listed twice.
    const rest = new Set(inType);
    for (const id of labelSet) {
      const here = inType.filter((i) => rest.has(i) && i.labelIds.includes(id));
      if (!here.length) continue;
      for (const i of here) rest.delete(i);
      out.push(`### ${labelName(id)}`, "", ...here.map((i) => line(i)), "");
    }
    if (rest.size) out.push(`### ${OTHER}`, "", ...[...rest].map((i) => line(i)), "");
    // The sub-group loop leaves a trailing blank line.
    while (out[out.length - 1] === "") out.pop();
  }
  return [...out, ""].join("\n");
}
