import { displayRepo } from "../config";
import { canonicalIssueUrl, fallbackIssueUrl } from "../github/url";
import type { ReadModel } from "../sync/read-model";
import { resolveRelease } from "../views/rows";
import type { ClientMeta, ClientOption, ClientRelease, SingleSelectKey, WireData, WireIssue } from "./types";

const SINGLE_SELECT_KEYS: SingleSelectKey[] = ["status", "priority", "team", "platform"];

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Everything the browser needs to filter, group and search instantly: compact
 * rows (no bodies) plus discovered metadata. Option names, colours and order
 * come from the synced project fields — nothing is hardcoded (SPEC §2).
 */
export function buildClientData(
  store: ReadModel,
  opts: { viewer: string; writeMode: boolean; demo: boolean; now?: Date },
): WireData {
  const now = opts.now ?? new Date();
  const today = now.toISOString().slice(0, 10);
  const repo = displayRepo();

  // Resolved by field ID through the discovered map (v5 1.3).
  const map = store.projectFieldMap();
  const fieldOf = (key: SingleSelectKey | "release") => (map[key] ? store.fields.get(map[key]!.id) : undefined);
  const fields = {} as Record<SingleSelectKey, ClientOption[]>;
  for (const key of SINGLE_SELECT_KEYS) {
    fields[key] = (fieldOf(key)?.options ?? []).map((o, i) => ({ id: o.id, name: o.name, color: o.color, position: i }));
  }

  const releaseField = fieldOf("release");
  const releases: ClientRelease[] = (releaseField?.iterations ?? [])
    .map((it) => ({
      id: it.id,
      title: it.title,
      startDate: it.startDate,
      duration: it.duration,
      endDate: addDays(it.startDate, it.duration),
    }))
    .sort((a, b) => a.startDate.localeCompare(b.startDate));

  const itemByIssue = new Map<string, (typeof store.projectItems extends Map<string, infer V> ? V : never)>();
  for (const p of store.projectItems.values()) itemByIssue.set(p.issueNodeId, p);

  const issues: WireIssue[] = [];
  const usedLogins = new Set<string>();
  for (const i of store.issues.values()) {
    const p = itemByIssue.get(i.nodeId);
    const assignees = i.assigneeIds.map((id) => store.ghUsers.get(id)?.login ?? id);
    for (const a of assignees) usedLogins.add(a.toLowerCase());
    const w: WireIssue = {
      id: i.nodeId,
      n: i.number,
      t: i.title,
      o: i.state.toLowerCase() === "open" ? 1 : 0,
      au: i.authorLogin,
      c: i.createdAt,
      u: i.updatedAt,
    };
    if (i.stateReason) w.sr = i.stateReason;
    if (p?.statusOpt) w.st = p.statusOpt;
    if (p?.priorityOpt) w.pr = p.priorityOpt;
    if (p?.teamOpt) w.tm = p.teamOpt;
    if (p?.platformOpt) w.pl = p.platformOpt;
    if (p?.releaseIter) w.rl = p.releaseIter;
    if (i.typeId) w.ty = i.typeId;
    if (i.milestoneId) w.ms = i.milestoneId;
    if (i.labelIds.length) w.lb = [...i.labelIds];
    if (assignees.length) w.as = assignees;
    if (i.parentNodeId) w.pa = i.parentNodeId;
    if (i.closedAt) w.cl = i.closedAt;
    // The browser rebuilds the common case. A link GitHub stored in another
    // repository (or a sample row) has to travel with the row, or the GitHub
    // button opens a different item that only shares the number.
    const canonical = canonicalIssueUrl(i.url, repo, i.number);
    if (canonical !== fallbackIssueUrl(repo, i.number)) w.gh = canonical;
    issues.push(w);
  }
  // Newest activity first is the natural default everywhere.
  issues.sort((a, b) => b.u.localeCompare(a.u));

  const users = [...store.ghUsers.values()]
    .filter((u) => u.login)
    .sort((a, b) => {
      // People who actually hold issues first, then alphabetical.
      const ua = usedLogins.has(a.login.toLowerCase()) ? 0 : 1;
      const ub = usedLogins.has(b.login.toLowerCase()) ? 0 : 1;
      return ua - ub || a.login.localeCompare(b.login);
    })
    .map((u) => ({ login: u.login, avatarUrl: u.avatarUrl }));

  const meta: ClientMeta = {
    repo,
    viewer: opts.viewer,
    writeMode: opts.writeMode,
    demo: opts.demo,
    generatedAt: now.toISOString(),
    today,
    fields,
    releases,
    currentReleaseId: resolveRelease(store, "current", today),
    nextReleaseId: resolveRelease(store, "next", today),
    previousReleaseId: resolveRelease(store, "previous", today),
    issueTypes: [...store.issueTypes.entries()].map(([id, t]) => ({ id, name: t.name, color: t.color })),
    labels: [...store.labels.entries()]
      .map(([id, l]) => ({ id, name: l.name, color: l.color }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    milestones: [...store.milestones.entries()]
      .map(([id, m]) => ({ id, title: m.title, state: m.state, dueOn: m.dueOn }))
      .sort((a, b) => b.title.localeCompare(a.title)),
    users,
  };

  return { meta, issues };
}
