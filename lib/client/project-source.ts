// What a task project pulls in from GitHub (SPEC §12.3): issues and PRs that
// match the project's saved filters, minus those an open task in the project
// already links. Pure, so the page and the tests share it.
import type { ProjectSource, Task } from "../tasks/model";
import { runExplorer } from "./explorer";
import { runPrs, type PrCtx } from "./prs";
import type { ClientIssue, ClientMeta, ClientPr } from "./types";

/** Where a new source starts: open issues and open PRs, nothing narrowed yet. */
export const NEW_SOURCE: ProjectSource = {
  issues: [{ field: "state", op: "in", values: ["open"] }],
  prs: [{ field: "state", values: ["open", "draft"] }],
};

/** A filter list that only picks a state matches nearly everything, so it pulls nothing in until narrowed. */
export function narrowed(filters: { field: string }[]): boolean {
  return filters.some((f) => f.field !== "state");
}

export type SourceRows = { issues: ClientIssue[]; prs: ClientPr[] };

export function sourceRows(
  source: ProjectSource | null,
  projectTasks: Pick<Task, "completedAt" | "links">[],
  data: { meta: ClientMeta; issues: ClientIssue[]; prs: ClientPr[]; prCtx: PrCtx },
): SourceRows {
  if (!source) return { issues: [], prs: [] };
  const linked = new Set(projectTasks.filter((t) => !t.completedAt).flatMap((t) => t.links.map((l) => l.nodeId)));
  const issues =
    source.issues && narrowed(source.issues)
      ? runExplorer(data.issues, source.issues, [{ field: "updated", dir: "desc" }], data.meta).filter((i) => !linked.has(i.nodeId))
      : [];
  const prs =
    source.prs && narrowed(source.prs) ? runPrs(data.prs, { filters: source.prs, sort: "updated", dir: "desc" }, data.prCtx).filter((p) => !linked.has(p.nodeId)) : [];
  return { issues, prs };
}
