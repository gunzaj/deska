// What a task project pulls in from GitHub (SPEC §12.3): issues that match the
// project's saved filters, minus those an open task in the project already
// links. Pure, so the page and the tests share it.
import type { ProjectSource, Task } from "../tasks/model";
import { runExplorer } from "./explorer";
import type { ClientIssue, ClientMeta } from "./types";

/** Where a new source starts: open issues, nothing narrowed yet. */
export const NEW_SOURCE: ProjectSource = {
  issues: [{ field: "state", op: "in", values: ["open"] }],
};

/** A filter list that only picks a state matches nearly everything, so it pulls nothing in until narrowed. */
export function narrowed(filters: { field: string }[]): boolean {
  return filters.some((f) => f.field !== "state");
}

export function sourceRows(
  source: ProjectSource | null,
  projectTasks: Pick<Task, "completedAt" | "links">[],
  data: { meta: ClientMeta; issues: ClientIssue[] },
): ClientIssue[] {
  if (!source?.issues || !narrowed(source.issues)) return [];
  const linked = new Set(projectTasks.filter((t) => !t.completedAt).flatMap((t) => t.links.map((l) => l.nodeId)));
  return runExplorer(data.issues, source.issues, [{ field: "updated", dir: "desc" }], data.meta).filter((i) => !linked.has(i.nodeId));
}
