// The in-app tab store (SPEC §4.2 [Tabs]): the pure model in lib/client/tabs.ts
// plus the window side (router, scroll, saving). Plain TS, no React, so it can be tested.
import {
  activate,
  activateNumber,
  activeTab,
  closeTab,
  currentUrl,
  cycle,
  initTabs,
  isTabUrl,
  MAX_TABS,
  normalizeUrl,
  openTab,
  parseSaved,
  recordNavigation,
  reopenClosed,
  restore,
  serialize,
  setScroll,
  step,
  type TabsState,
} from "@/lib/client/tabs";

/**
 * In-app tabs (browser-style): ⌘-click or middle-click an issue (or any in-app
 * link) opens it in a background tab; ⌘⇧-click opens it and switches. Every
 * tab keeps its own Back/Forward (⌘[ / ⌘]) and scroll position. Only the
 * active tab is rendered: switching shows the tab's URL again.
 */
export type Store = {
  get: () => TabsState;
  subscribe: (l: () => void) => () => void;
  /** The tab that was just opened or found, briefly highlighted. */
  flash: () => { id: string; at: number } | null;
  open: (url: string, activate: boolean) => void;
  openIssue: (n: number, activate: boolean) => void;
  switchTo: (id: string) => void;
  close: (id: string) => void;
  reopen: () => void;
  number: (n: number) => void;
  cycle: (dir: 1 | -1) => void;
  step: (dir: 1 | -1) => void;
  /** Called with every URL the active tab shows. */
  observe: (url: string) => void;
  setNavigate: (f: (url: string) => void) => void;
  setNotify: (f: (message: string) => void) => void;
  setTitle: (id: string, url: string, title: string) => void;
  title: (url: string) => string | undefined;
  /** Changes with every new title, so the strip can follow them. */
  titleVersion: () => number;
  /** Save now what is waiting to be saved (the window is closing). */
  flush: () => void;
};

/** How long a tab's own navigation may take before a URL change counts as the user's again. */
const PENDING_MS = 4000;

const BLANK: TabsState = { tabs: [{ id: "blank", entries: ["/"], index: 0 }], active: "blank", closed: [] };

/** Home routes "/" redirects to: launching on one of them shows the saved active tab. */
const HOME = new Set(["/my", "/tasks"]);

/** The main scroller of the page shown: the tallest scrolling area in the content panel. */
function mainScroller(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  const els = Array.from(document.querySelectorAll<HTMLElement>("main .overflow-auto, main .overflow-y-auto"));
  let best: HTMLElement | null = null;
  for (const el of els) if (!best || el.clientHeight > best.clientHeight) best = el;
  return best;
}

/** Bring a tab's scroll position back once its page has rendered tall enough (up to ~1 s). */
function restoreScroll(top: number | undefined) {
  if (top == null || typeof requestAnimationFrame === "undefined") return;
  let frames = 0;
  const tick = () => {
    const el = mainScroller();
    if (el && (el.scrollHeight - el.clientHeight >= top || frames > 60)) {
      el.scrollTop = top;
      return;
    }
    frames += 1;
    if (frames <= 60) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

export function createStore(saved: unknown, persist: boolean): Store {
  let state: TabsState | null = null;
  /** Set by the first URL seen: the saved tabs are restored then, never later. */
  let started = false;
  let lastUrl = "";
  let pending: { url: string; at: number } | null = null;
  let titleVersion = 0;
  let navigate: (url: string) => void = () => {};
  let notify: (message: string) => void = () => {};
  let flash: { id: string; at: number } | null = null;
  const titles = new Map<string, string>();
  const listeners = new Set<() => void>();
  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  const send = () => {
    saveTimer = null;
    if (!state) return;
    void fetch("/api/settings/tabs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(serialize(state)), keepalive: true }).catch(() => {
      /* cosmetic: a failed save only loses the tabs on the next launch */
    });
  };
  const save = () => {
    if (!persist || !state) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(send, 400);
  };
  const set = (next: TabsState) => {
    if (next === state) return;
    state = next;
    for (const l of listeners) l();
    save();
  };
  const ensure = () => (state ??= initTabs(lastUrl || "/"));
  /** Show `url` in the window, unless it already is. */
  const go = (url: string, scroll?: number) => {
    if (url !== lastUrl) {
      pending = { url, at: Date.now() };
      navigate(url);
    }
    restoreScroll(scroll);
  };
  /** Show the tab `next` makes active; the tab being left keeps its scroll position. */
  const show = (next: TabsState) => {
    const s = ensure();
    const leaving = next.active !== s.active;
    set(leaving ? setScroll(next, s.active, mainScroller()?.scrollTop ?? 0) : next);
    const t = activeTab(state!);
    // A tab left at the top is shown at the top, also when the page under it stays mounted.
    if (currentUrl(t) !== lastUrl) go(currentUrl(t), leaving ? (t.scroll ?? 0) : undefined);
    else if (leaving) restoreScroll(t.scroll ?? 0);
  };
  const ping = (id: string) => {
    flash = { id, at: Date.now() };
    for (const l of listeners) l();
  };

  const store: Store = {
    // Before the first URL is seen, one blank tab (no strip) without starting the state,
    // so the first observe() still restores the saved tabs.
    get: () => state ?? BLANK,
    subscribe: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    flash: () => flash,
    open: (raw, act) => {
      if (!isTabUrl(raw)) return;
      const r = openTab(ensure(), normalizeUrl(raw), act);
      if (r.full) {
        notify(`${MAX_TABS} tabs are open. Close one first.`);
        return;
      }
      if (act) show(r.state);
      else set(r.state);
      ping(r.id);
    },
    openIssue: (n, act) => store.open(`/issues/${n}`, act),
    switchTo: (id) => show(activate(ensure(), id)),
    close: (id) => {
      const s = ensure();
      if (s.tabs.length <= 1) return;
      // A reopened tab comes back where it was scrolled.
      show(closeTab(id === s.active ? setScroll(s, id, mainScroller()?.scrollTop ?? 0) : s, id));
    },
    reopen: () => show(reopenClosed(ensure())),
    number: (n) => show(activateNumber(ensure(), n)),
    cycle: (dir) => show(cycle(ensure(), dir)),
    step: (dir) => show(step(ensure(), dir)),
    observe: (url) => {
      const prev = lastUrl;
      lastUrl = url;
      if (!started) {
        started = true;
        const restored = persist ? restore(parseSaved(saved), url, HOME.has(url)) : initTabs(url);
        state = restored;
        for (const l of listeners) l();
        const t = activeTab(restored);
        if (currentUrl(t) !== url) go(currentUrl(t), t.scroll);
        return;
      }
      // The same URL again (an effect run twice) is no navigation.
      if (url === prev) return;
      // A tab's own navigation that never changed the URL (it led back here) has lapsed.
      if (pending && Date.now() - pending.at > PENDING_MS) pending = null;
      if (pending != null) {
        const was = pending.url;
        pending = null;
        // A redirect on the way (say "/" to "/my") replaces the entry the tab asked for.
        if (url !== was) {
          const cur = ensure();
          const t = activeTab(cur);
          set({ ...cur, tabs: cur.tabs.map((x) => (x.id === t.id ? { ...x, entries: x.entries.map((e, i) => (i === x.index ? url : e)) } : x)) });
        }
        return;
      }
      set(recordNavigation(ensure(), url));
    },
    setNavigate: (f) => {
      navigate = f;
    },
    setNotify: (f) => {
      notify = f;
    },
    setTitle: (id, url, title) => {
      if (titles.get(url) === title) return;
      titles.set(url, title);
      titleVersion += 1;
      if (state?.tabs.some((t) => t.id === id)) for (const l of listeners) l();
    },
    title: (url) => titles.get(url),
    titleVersion: () => titleVersion,
    flush: () => {
      if (!saveTimer) return;
      clearTimeout(saveTimer);
      send();
    },
  };
  return store;
}
