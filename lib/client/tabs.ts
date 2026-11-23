// In-app tabs: the pure model. Every tab is a full Deska view with its own
// Back/Forward history; only the active tab is rendered, so a background tab
// is its URL history plus a scroll position. The React side (components/app/
// tabs.tsx) drives the router; everything here is plain data, for tests.

export type Tab = {
  id: string;
  /** In-app URLs (path + query), oldest first. */
  entries: string[];
  /** The entry shown. */
  index: number;
  /** The tab that opened this one, for placing the next background tab after it. */
  opener?: string;
  /** Scroll offset of the tab's main scroller when it was left. */
  scroll?: number;
  /** Where a closed tab stood, so ⌘⇧T puts it back there. */
  closedAt?: number;
};

export type TabsState = {
  tabs: Tab[];
  active: string;
  /** Recently closed tabs, newest last (⌘⇧T reopens). */
  closed: Tab[];
};

export const MAX_TABS = 30;
const MAX_ENTRIES = 50;
const MAX_CLOSED = 10;
/** Query params of the side panels: moving between issues in a panel is not a history step. */
const PANEL_PARAMS = ["issue", "task"] as const;

let seq = 0;
export function newTabId(): string {
  seq += 1;
  return `t${Date.now().toString(36)}${seq.toString(36)}`;
}

/** An in-app URL: a path on this origin, never `//host` or a scheme. */
export function isAppUrl(u: unknown): u is string {
  return typeof u === "string" && u.startsWith("/") && !u.startsWith("//") && !u.includes("\\") && u.length <= 2000;
}

/** Pages outside the app shell (no tabs there) and the API: never a tab. */
const NOT_A_TAB = /^\/(api|onboarding|importing|quick-add|_next)(\/|\?|#|$)/;

/** A URL a tab may show: an in-app page inside the shell. */
export function isTabUrl(u: unknown): u is string {
  return isAppUrl(u) && !NOT_A_TAB.test(u);
}

/**
 * The form the window reports a URL in (path, then the query as
 * `URLSearchParams` writes it, no hash), so a tab's URL can be compared with it.
 */
export function normalizeUrl(url: string): string {
  const hash = url.indexOf("#");
  const bare = hash < 0 ? url : url.slice(0, hash);
  const q = bare.indexOf("?");
  if (q < 0) return bare;
  const qs = new URLSearchParams(bare.slice(q + 1)).toString();
  return qs ? `${bare.slice(0, q)}?${qs}` : bare.slice(0, q);
}

export function currentUrl(t: Tab): string {
  return t.entries[t.index] ?? "/";
}

export function activeTab(s: TabsState): Tab {
  return s.tabs.find((t) => t.id === s.active) ?? s.tabs[0]!;
}

export function initTabs(url: string, id = newTabId()): TabsState {
  return { tabs: [{ id, entries: [url], index: 0 }], active: id, closed: [] };
}

function split(url: string): { path: string; params: URLSearchParams } {
  const q = url.indexOf("?");
  return q < 0 ? { path: url, params: new URLSearchParams() } : { path: url.slice(0, q), params: new URLSearchParams(url.slice(q + 1)) };
}

/**
 * Whether moving from `prev` to `next` is a new history step ("push") or
 * changes the current one ("replace"). A new page is a step, and so is opening
 * a side panel (Back closes it, as before tabs). Anything else on the same
 * page (filters, the panel moving to another issue, closing it) replaces.
 */
export function classifyNav(prev: string, next: string): "push" | "replace" {
  const a = split(prev);
  const b = split(next);
  if (a.path !== b.path) return "push";
  const opened = PANEL_PARAMS.some((p) => !a.params.has(p) && b.params.has(p)) && !PANEL_PARAMS.some((p) => a.params.has(p));
  return opened ? "push" : "replace";
}

function mapActive(s: TabsState, f: (t: Tab) => Tab): TabsState {
  return { ...s, tabs: s.tabs.map((t) => (t.id === s.active ? f(t) : t)) };
}

/** The active tab's page changed to `url` by in-app navigation. */
export function recordNavigation(s: TabsState, url: string): TabsState {
  return mapActive(s, (t) => {
    const cur = currentUrl(t);
    if (cur === url) return t;
    if (classifyNav(cur, url) === "push") {
      const entries = [...t.entries.slice(0, t.index + 1), url].slice(-MAX_ENTRIES);
      return { ...t, entries, index: entries.length - 1 };
    }
    // Closing a panel lands back on the step before it opened: one entry, not two.
    if (t.index > 0 && t.entries[t.index - 1] === url) {
      const entries = [...t.entries.slice(0, t.index), ...t.entries.slice(t.index + 1)];
      return { ...t, entries, index: t.index - 1 };
    }
    const entries = [...t.entries];
    entries[t.index] = url;
    return { ...t, entries };
  });
}

/** The pathname of an issue page (`/issues/N`) a URL shows, if it is one. */
export function issueOfUrl(url: string): number | null {
  const m = /^\/issues\/(\d+)(?:[?#]|$)/.exec(url);
  return m ? Number(m[1]) : null;
}

/**
 * Open `url` in a new tab: right after the active tab and the tabs it already
 * opened, like a browser. An issue already open in a tab is not opened twice:
 * that tab is returned as `existing` (the strip flashes it, or it is activated).
 */
export function openTab(s: TabsState, url: string, activate: boolean): { state: TabsState; id: string; existing: boolean; full: boolean } {
  const n = issueOfUrl(url);
  if (n != null) {
    const found = s.tabs.find((t) => issueOfUrl(currentUrl(t)) === n);
    if (found) return { state: activate ? { ...s, active: found.id } : s, id: found.id, existing: true, full: false };
  }
  if (s.tabs.length >= MAX_TABS) return { state: s, id: s.active, existing: false, full: true };
  const tab: Tab = { id: newTabId(), entries: [url], index: 0, opener: s.active };
  const at = s.tabs.findIndex((t) => t.id === s.active);
  let insert = at + 1;
  while (insert < s.tabs.length && s.tabs[insert]!.opener === s.active) insert += 1;
  const tabs = [...s.tabs.slice(0, insert), tab, ...s.tabs.slice(insert)];
  return { state: { ...s, tabs, active: activate ? tab.id : s.active }, id: tab.id, existing: false, full: false };
}

/** Close a tab. The last tab never closes (closing the window is the caller's job). */
export function closeTab(s: TabsState, id: string): TabsState {
  if (s.tabs.length <= 1) return s;
  const at = s.tabs.findIndex((t) => t.id === id);
  if (at < 0) return s;
  const gone = s.tabs[at]!;
  const tabs = s.tabs.filter((t) => t.id !== id);
  let active = s.active;
  if (s.active === id) {
    // Back to the tab that opened it when it is still there, else the right-hand neighbour.
    const opener = gone.opener ? tabs.find((t) => t.id === gone.opener) : undefined;
    const right = s.tabs[at + 1];
    const neighbour = right && right.opener === gone.opener ? right : undefined;
    active = (neighbour ?? opener ?? tabs[Math.min(at, tabs.length - 1)]!).id;
  }
  // Tabs it opened forget it, so they no longer group after it.
  const cleaned = tabs.map((t) => (t.opener === id ? { ...t, opener: undefined } : t));
  return { tabs: cleaned, active, closed: [...s.closed, { ...gone, opener: undefined, closedAt: at }].slice(-MAX_CLOSED) };
}

export function reopenClosed(s: TabsState): TabsState {
  const closed = s.closed.at(-1);
  if (!closed || s.tabs.length >= MAX_TABS) return s;
  const { closedAt, ...tab } = closed;
  const at = Math.min(closedAt ?? s.tabs.length, s.tabs.length);
  const tabs = [...s.tabs.slice(0, at), tab, ...s.tabs.slice(at)];
  return { tabs, active: tab.id, closed: s.closed.slice(0, -1) };
}

export function activate(s: TabsState, id: string): TabsState {
  return s.tabs.some((t) => t.id === id) ? { ...s, active: id } : s;
}

/** ⌘1–⌘8 pick the tab at that place; ⌘9 is always the last tab. */
export function activateNumber(s: TabsState, n: number): TabsState {
  const t = n === 9 ? s.tabs.at(-1) : s.tabs[n - 1];
  return t ? { ...s, active: t.id } : s;
}

export function cycle(s: TabsState, dir: 1 | -1): TabsState {
  const at = s.tabs.findIndex((t) => t.id === s.active);
  const next = s.tabs[(at + dir + s.tabs.length) % s.tabs.length]!;
  return { ...s, active: next.id };
}

/** Back (-1) or Forward (+1) in the active tab's own history. */
export function step(s: TabsState, dir: 1 | -1): TabsState {
  return mapActive(s, (t) => {
    const index = t.index + dir;
    return index < 0 || index >= t.entries.length ? t : { ...t, index };
  });
}

export function setScroll(s: TabsState, id: string, scroll: number): TabsState {
  return { ...s, tabs: s.tabs.map((t) => (t.id === id ? { ...t, scroll } : t)) };
}

/** What is kept across relaunches: tabs and the active one, not the closed stack. */
export type SavedTabs = { tabs: { entries: string[]; index: number }[]; active: number };

/**
 * A tab's history with only the URLs a tab may show. The entry shown stays the
 * one shown; when it is dropped itself, the nearest earlier one is.
 */
function cleanHistory(entries: unknown[], index: number): { entries: string[]; index: number } | null {
  const kept: string[] = [];
  let at = -1;
  entries.forEach((e, i) => {
    if (!isTabUrl(e)) return;
    kept.push(e);
    if (i <= index) at = kept.length - 1;
  });
  if (!kept.length) return null;
  const cut = Math.max(0, kept.length - MAX_ENTRIES);
  return { entries: kept.slice(cut), index: Math.max(0, (at < 0 ? 0 : at) - cut) };
}

/** Only what can be restored is sent: a URL too long to keep is dropped here, so one never fails the whole save. */
export function serialize(s: TabsState): SavedTabs {
  const tabs: SavedTabs["tabs"] = [];
  let active = 0;
  for (const t of s.tabs) {
    const clean = cleanHistory(t.entries, t.index);
    if (!clean) continue;
    if (t.id === s.active) active = tabs.length;
    tabs.push(clean);
  }
  return { tabs, active };
}

/** Anything malformed is dropped; nothing usable is null. */
export function parseSaved(v: unknown): SavedTabs | null {
  if (!v || typeof v !== "object") return null;
  const raw = (v as { tabs?: unknown }).tabs;
  if (!Array.isArray(raw)) return null;
  const tabs: SavedTabs["tabs"] = [];
  for (const t of raw.slice(0, MAX_TABS)) {
    if (!t || typeof t !== "object") continue;
    const entries = (t as { entries?: unknown }).entries;
    if (!Array.isArray(entries)) continue;
    const i = (t as { index?: unknown }).index;
    const clean = cleanHistory(entries, Number.isInteger(i) ? Math.max(i as number, 0) : entries.length - 1);
    if (clean) tabs.push(clean);
  }
  if (!tabs.length) return null;
  const a = (v as { active?: unknown }).active;
  const active = Number.isInteger(a) ? Math.min(Math.max(a as number, 0), tabs.length - 1) : 0;
  return { tabs, active };
}

/**
 * Restored tabs. The window opens on a launch URL: the plain home page ("/",
 * or where it redirects) shows the saved active tab; anything more specific
 * (a reminder opening a task) is shown in the saved active tab instead.
 */
export function restore(saved: SavedTabs | null, launchUrl: string, isHome: boolean): TabsState {
  if (!saved) return initTabs(launchUrl);
  const tabs: Tab[] = saved.tabs.map((t) => ({ id: newTabId(), entries: t.entries, index: t.index }));
  const state: TabsState = { tabs, active: tabs[saved.active]!.id, closed: [] };
  return isHome ? state : recordNavigation(state, launchUrl);
}
