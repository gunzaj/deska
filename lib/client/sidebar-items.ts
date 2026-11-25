// Favorites and the manual order of sidebar items. Pure, so what a star or a
// drop does to the stored layout is unit-tested.
import type { SidebarLayout, SidebarSection } from "../tasks/model";

/** A list an item can be shown in: Favorites, or the section it belongs to. */
export type SidebarList = "favorites" | SidebarSection;

export const NAV_DRAG_TYPE = "application/x-deska-nav";

/** The current sprint's link changes its address every sprint, so it has a key of its own. */
export const CURRENT_KEY = "current";

/** Favorites of a sidebar nobody has changed: the four that used to sit on top. */
export const DEFAULT_FAVORITES: readonly string[] = ["/home", "/triage", "/my", "/watching"];

/** Built-in pages. They can be absent for a while (no Sprint field, tasks-only mode), so their slots are kept. */
const BUILT_IN = new Set([...DEFAULT_FAVORITES, "/tasks", "/tasks/today", "/tasks/upcoming", "/tasks/completed", "/issues", "/backlog", "/releases", CURRENT_KEY, "/epics", "/insights"]);

export type Keyed = { key: string; home: SidebarSection };
export type SidebarLists<T> = { favorites: T[]; sections: Record<SidebarSection, T[]> };

export const favoriteKeys = (layout: SidebarLayout | null | undefined): string[] => [...(layout?.favorites ?? DEFAULT_FAVORITES)];

/** Stored keys first, in their order; the rest keep the order they came in. */
function sortByKeys<T extends Keyed>(items: T[], stored: readonly string[] | undefined): T[] {
  if (!stored?.length) return items;
  const at = new Map(stored.map((k, i) => [k, i]));
  return [...items].sort((a, b) => (at.get(a.key) ?? Infinity) - (at.get(b.key) ?? Infinity));
}

/** Every item once: in Favorites when starred, otherwise in its own section, each list in its stored order. */
export function arrangeSidebar<T extends Keyed>(items: T[], layout: SidebarLayout | null | undefined): SidebarLists<T> {
  const favs = favoriteKeys(layout);
  const starred = new Set(favs);
  const sections = {} as Record<SidebarSection, T[]>;
  for (const item of items) if (!starred.has(item.key)) (sections[item.home] ??= []).push(item);
  for (const id of Object.keys(sections) as SidebarSection[]) sections[id] = sortByKeys(sections[id], layout?.items?.[id]);
  return { favorites: sortByKeys(items.filter((i) => starred.has(i.key)), favs), sections };
}

/**
 * The order to store: the shown keys, plus the stored keys that are not shown
 * now but still exist (a starred project keeps its slot in Projects; Backlog
 * keeps its slot while no Sprint field is mapped), each after the key it
 * followed. Keys of deleted things are dropped.
 */
function withAbsent(stored: readonly string[], shown: string[], exists: (key: string) => boolean): string[] {
  const out = [...shown];
  let prev: string | null = null;
  for (const key of stored) {
    if (!out.includes(key)) {
      if (!BUILT_IN.has(key) && !exists(key)) continue;
      out.splice(prev === null ? 0 : out.indexOf(prev) + 1, 0, key);
    }
    prev = key;
  }
  return out;
}

function place(keys: string[], key: string, target: string | null, after: boolean): string[] {
  const out = keys.filter((k) => k !== key);
  const at = target === null ? -1 : out.indexOf(target);
  out.splice(at < 0 ? out.length : at + (after ? 1 : 0), 0, key);
  return out;
}

type Change = Pick<SidebarLayout, "favorites" | "items">;

/** Star or unstar an item. A new favorite goes to the end of Favorites; an unstarred one returns to its slot in its section. */
export function toggleFavorite(layout: SidebarLayout | null | undefined, shown: string[], key: string, exists: (key: string) => boolean): Change {
  const stored = favoriteKeys(layout);
  const favorites = stored.includes(key) ? withAbsent(stored.filter((k) => k !== key), shown.filter((k) => k !== key), exists) : withAbsent(stored, [...shown, key], exists);
  return { favorites, items: layout?.items };
}

/**
 * Drop `drag` before or after `target` in `list` (or at its end, with no
 * target). Allowed inside the item's own list, into Favorites (which stars
 * it), and from Favorites back into its own section (which unstars it); any
 * other drop returns null.
 */
export function dropItem(
  layout: SidebarLayout | null | undefined,
  shown: SidebarLists<string>,
  drag: { key: string; home: SidebarSection; from: SidebarList },
  to: { list: SidebarList; target: string | null; after: boolean },
  exists: (key: string) => boolean,
): Change | null {
  if (to.list !== "favorites" && to.list !== drag.home) return null;
  if (to.target === drag.key && to.list === drag.from) return null;
  const stored = favoriteKeys(layout);
  let favorites = layout?.favorites;
  if (to.list === "favorites") favorites = withAbsent(stored, place(shown.favorites, drag.key, to.target, to.after), exists);
  else if (drag.from === "favorites") favorites = withAbsent(stored.filter((k) => k !== drag.key), shown.favorites.filter((k) => k !== drag.key), exists);
  let items = layout?.items;
  if (to.list === drag.home) items = { ...items, [drag.home]: withAbsent(items?.[drag.home] ?? [], place(shown.sections[drag.home] ?? [], drag.key, to.target, to.after), exists) };
  return { favorites, items };
}
