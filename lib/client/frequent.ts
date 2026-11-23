// The user's most used labels and assignees in the browser (SPEC §4.8): the
// pickers' order, and one shared copy of GET /api/me/frequent. The ranking is
// pure, so it's unit-tested without React.
import { isUnauthorized } from "./session";

/** Labels by ID and assignees by lower-cased login, most used first. */
export type FrequentChoices = { labels: string[]; assignees: string[] };

export const NO_FREQUENT: FrequentChoices = { labels: [], assignees: [] };

/**
 * A picker's order: the issue's current values, then the frequent choices
 * (most used first), then everything else as it came.
 */
export function rankChoices<T>(items: T[], frequent: string[], keyOf: (item: T) => string, isCurrent: (item: T) => boolean = () => false): T[] {
  const place = new Map(frequent.map((k, i) => [k, i]));
  const rank = (item: T): number => (isCurrent(item) ? -1 : (place.get(keyOf(item)) ?? frequent.length));
  return items
    .map((item, i) => ({ item, i, r: rank(item) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.item);
}

/** Keep `items` in the order of `ids`; an item not in it goes last. */
export function inOrder<T extends { id: string }>(items: T[], ids: string[]): T[] {
  return rankChoices(items, ids, (i) => i.id);
}

let current: FrequentChoices = NO_FREQUENT;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | null = null;

export const getFrequent = (): FrequentChoices => current;

export function subscribeFrequent(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => void listeners.delete(onChange);
}

const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

export async function loadFrequent(): Promise<void> {
  const res = await fetch("/api/me/frequent", { cache: "no-store" }).catch(() => null);
  if (isUnauthorized(res) || !res?.ok) return;
  const next = (await res.json().catch(() => null)) as Partial<FrequentChoices> | null;
  if (!Array.isArray(next?.labels) || !Array.isArray(next.assignees)) return;
  if (same(next.labels, current.labels) && same(next.assignees, current.assignees)) return;
  current = { labels: next.labels, assignees: next.assignees };
  for (const l of listeners) l();
}

/** After an add was written. Waits a moment, so a bulk edit asks once, not once per issue. */
export function refreshFrequentSoon(delayMs = 1500): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void loadFrequent();
  }, delayMs);
}
