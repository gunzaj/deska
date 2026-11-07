// Start the app's independent requests together (v5 3.9). The shell waits for
// the issue payload before it mounts the task, watch, snooze and
// notification stores, and each of those then began its own request: the page
// waited for them one after the other. These are started when the provider
// mounts, alongside the issue payload, and each store takes its response when
// it asks for the same URL.

type Warm = { url: string; init?: RequestInit };

/** The first load of each store, with the options the store uses (same URL, same cache mode). */
const WARM: Warm[] = [
  { url: "/api/tasks", init: { cache: "no-store" } },
  { url: "/api/notifications", init: { cache: "no-store" } },
  { url: "/api/me/prefs", init: { cache: "no-store" } },
  { url: "/api/triage/snoozes", init: { cache: "no-store" } },
  { url: "/api/watches", init: { cache: "no-store" } },
];

/** A response is only worth taking while it is this fresh; after that the store asks again. */
export const PRELOAD_TTL_MS = 15_000;

const pending = new Map<string, { at: number; response: Promise<Response | null> }>();

export function preloadAppFetches(now = Date.now()): void {
  for (const { url, init } of WARM) {
    if (pending.has(url)) continue;
    pending.set(url, { at: now, response: fetch(url, init).catch(() => null) });
  }
}

/**
 * `fetch`, except that a response started by `preloadAppFetches` for this URL is
 * handed over (once). A failed or stale preload falls back to a normal request.
 */
export async function fetchPreloaded(url: string, init?: RequestInit): Promise<Response> {
  const hit = pending.get(url);
  pending.delete(url);
  if (hit && Date.now() - hit.at < PRELOAD_TTL_MS) {
    const res = await hit.response;
    if (res) return res;
  }
  return fetch(url, init);
}

/** Tests only. */
export function __resetPreload(): void {
  pending.clear();
}
