// "My team" default filter: every list and Insights start filtered to the
// viewer's Team, so what they see is what concerns them. Pure rules here.
import type { Filter } from "../views/view";
import type { ClientMeta } from "./types";

export const teamFilter = (teamId: string): Filter => ({ field: "team", op: "in", values: [teamId] });

/** The default Team, if it still exists in the project (an option can be deleted on GitHub). */
export function validDefaultTeam(defaultTeam: string | null | undefined, meta: Pick<ClientMeta, "fields">): string | null {
  return defaultTeam && meta.fields.team.some((t) => t.id === defaultTeam) ? defaultTeam : null;
}

const mentionsTeam = (filters: Filter[]) => filters.some((f) => f.field === "team" || (f.field === "any" && f.filters.some((g) => g.field === "team")));

/**
 * The filters to run: the page's own, plus the default Team unless the page
 * already says something about Team (a saved view for another team stays that team's).
 */
export function withTeamScope(filters: Filter[], base: Filter[], teamId: string | null): Filter[] {
  if (!teamId || mentionsTeam(filters) || mentionsTeam(base)) return filters;
  return [...filters, teamFilter(teamId)];
}
