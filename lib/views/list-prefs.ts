import { z } from "zod";
import { viewSchema } from "./view";

/**
 * The defaults of the built-in lists (My issues, All issues, Backlog, Epics,
 * a Release page, a dimension value page): the filters and display options a
 * page opens with, saved by the viewer. Saved views are named and listed;
 * these are one per page, and the page key names them (`my`, `release`,
 * `dimension:<optionId>`).
 *
 * Stored as one JSON value in `ui.lists` (ADR-001, app_settings), so a
 * relaunch, a backup and an export carry them. An imported value is untrusted
 * like an imported view: every entry goes through the same strict state schema
 * and the map has its own limits.
 */
export const LIST_PREFS_LIMIT = 100;
export const LIST_KEY_MAX = 120;

export const listStateSchema = viewSchema.pick({ filters: true, sort: true, groupBy: true, layout: true, boardColumnsField: true, columns: true });
export type ListState = z.infer<typeof listStateSchema>;
export type ListPrefs = Record<string, ListState>;

/** `my`, `backlog`, `release`, `dimension:<optionId>`: a page key, never a display name. */
export const listKeySchema = z
  .string()
  .min(1)
  .max(LIST_KEY_MAX)
  .regex(/^[a-z][a-z0-9-]*(:[A-Za-z0-9_-]+)?$/, "invalid list key");

/** Valid entries only; a bad key or state is skipped, as an imported view list would be. */
export function parseListPrefs(raw: unknown): ListPrefs {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: ListPrefs = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (Object.keys(out).length >= LIST_PREFS_LIMIT) break;
    if (!listKeySchema.safeParse(key).success) continue;
    const parsed = listStateSchema.safeParse(value);
    if (parsed.success) out[key] = parsed.data;
  }
  return out;
}
