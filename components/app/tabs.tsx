"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { currentUrl, issueOfUrl, isTabUrl, type Tab, type TabsState } from "@/lib/client/tabs";
import { createStore, type Store } from "./tab-store";
import { Icon } from "../icons";
import { useToast } from "../ui/toast";
import { rememberIssue } from "./open-issue";
import { useAppData } from "./provider";
import { useTasksOnly } from "./tasks-only";

const TabsContext = createContext<Store | null>(null);

export function useTabs(): Store | null {
  return useContext(TabsContext);
}

function useTabsState(store: Store): TabsState {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

/** Open an issue in a tab from a click: background, or switching with ⇧. Null outside the provider. */
export function useOpenIssueInTab() {
  const store = useTabs();
  return useCallback(
    (n: number, activateIt = false) => {
      if (!store) return;
      rememberIssue(n);
      store.openIssue(n, activateIt);
    },
    [store],
  );
}

/** The page inside the app shell an anchor points at, if any (never onboarding or the API: no tabs there). */
function appHref(a: HTMLAnchorElement): string | null {
  if (a.target === "_blank" || a.hasAttribute("download")) return null;
  const raw = a.getAttribute("href");
  return isTabUrl(raw) ? raw : null;
}

/** ⌘ on macOS, Ctrl elsewhere. On macOS Ctrl+W, Ctrl+T and the like edit text, so Ctrl is never the tab key there. */
function modKey(e: KeyboardEvent | MouseEvent): boolean {
  return /Mac|iPhone|iPad/.test(navigator.platform) ? e.metaKey : e.ctrlKey;
}

/** What a modified or middle click on `target` opens in a tab, if anything. */
function tabTarget(target: EventTarget | null, meta: boolean): string | null {
  if (!(target instanceof Element)) return null;
  const el = target.closest<HTMLElement>("[data-tab-issue]");
  if (el) {
    // List rows: ⌘-click on the number or title opens a tab, elsewhere it multi-selects.
    if (meta && el.hasAttribute("data-tab-title-only") && !target.closest("[data-tab-title]")) return null;
    const n = Number(el.dataset.tabIssue);
    return Number.isInteger(n) && n > 0 ? `/issues/${n}` : null;
  }
  const a = target.closest("a");
  return a ? appHref(a) : null;
}

/** Keys and clicks for tabs, mounted once with the provider. */
function TabInput({ store }: { store: Store }) {
  const { toast } = useToast();
  useEffect(() => store.setNotify((message) => toast({ message })), [store, toast]);
  useEffect(() => {
    const modal = () => !!document.querySelector('[role="dialog"][aria-modal="true"]');
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (e.ctrlKey && !e.metaKey && !e.altKey && e.key === "Tab") {
        if (store.get().tabs.length < 2 || modal()) return;
        e.preventDefault();
        store.cycle(e.shiftKey ? -1 : 1);
        return;
      }
      if (!modKey(e) || e.altKey || modal()) return;
      const code = e.code;
      if (code === "KeyW" && !e.shiftKey) {
        e.preventDefault();
        const s = store.get();
        if (s.tabs.length > 1) store.close(s.active);
        else window.close();
      } else if (code === "KeyT" && e.shiftKey) {
        e.preventDefault();
        store.reopen();
      } else if (/^Digit[1-9]$/.test(code) && !e.shiftKey) {
        if (store.get().tabs.length < 2) return;
        e.preventDefault();
        store.number(Number(code.slice(5)));
      } else if (code === "BracketLeft" || code === "BracketRight") {
        e.preventDefault();
        const dir = code === "BracketLeft" ? -1 : 1;
        if (e.shiftKey) store.cycle(dir);
        else store.step(dir);
      }
    };
    // Nothing else sees it: not the row (no panel, no selection) and not the
    // panel's outside-click rule, which listens on window too.
    const consume = (e: Event) => {
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    const open = (e: MouseEvent, url: string) => {
      consume(e);
      const n = issueOfUrl(url);
      if (n != null) rememberIssue(n);
      store.open(url, e.shiftKey);
    };
    const onClick = (e: MouseEvent) => {
      if (e.button !== 0 || !modKey(e) || e.altKey) return;
      const url = tabTarget(e.target, true);
      if (url) open(e, url);
    };
    const onAux = (e: MouseEvent) => {
      if (e.button !== 1) return;
      const url = tabTarget(e.target, false);
      if (url) open(e, url);
    };
    // Middle-button down: no autoscroll over something that opens a tab.
    const onDown = (e: MouseEvent) => {
      if (e.button === 1 && tabTarget(e.target, false)) e.preventDefault();
      if (e.button === 3 || e.button === 4) e.preventDefault();
    };
    // The mouse's Back and Forward buttons step through the tab's own history.
    const onUp = (e: MouseEvent) => {
      if (e.button !== 3 && e.button !== 4) return;
      e.preventDefault();
      store.step(e.button === 3 ? -1 : 1);
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("click", onClick, true);
    window.addEventListener("auxclick", onAux, true);
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("mouseup", onUp, true);
    // Closing the window: what changed in the last moment is still saved.
    window.addEventListener("pagehide", store.flush);
    return () => {
      window.removeEventListener("pagehide", store.flush);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("click", onClick, true);
      window.removeEventListener("auxclick", onAux, true);
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("mouseup", onUp, true);
    };
  }, [store]);
  return null;
}

/** Follows the window's URL into the active tab. Needs a Suspense boundary (search params). */
export function TabUrlSync() {
  const store = useTabs();
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const qs = params.toString();
  const url = qs ? `${path}?${qs}` : path;
  useEffect(() => {
    store?.setNavigate((u) => router.replace(u, { scroll: false }));
  }, [store, router]);
  useEffect(() => {
    store?.observe(url);
    // The page's own heading names its tab (an issue tab is named from the data).
    if (!store) return;
    const id = store.get().active;
    const t = setTimeout(() => {
      const h = document.querySelector("main h1")?.textContent?.trim();
      if (h) store.setTitle(id, url, h.slice(0, 120));
    }, 250);
    return () => clearTimeout(t);
  }, [store, url]);
  return null;
}

export function TabsProvider({ saved, persist, children }: { saved: unknown; persist: boolean; children: ReactNode }) {
  const [store] = useState(() => createStore(saved, persist));
  return (
    <TabsContext.Provider value={store}>
      <TabInput store={store} />
      {children}
    </TabsContext.Provider>
  );
}

const PAGE_TITLES: Record<string, string> = {
  "/my": "My issues",
  "/triage": "Triage",
  "/watching": "Watching",
  "/issues": "All issues",
  "/backlog": "Backlog",
  "/board": "Board",
  "/releases": "Releases",
  "/epics": "Epics",
  "/insights": "Insights",
  "/views": "Views",
  "/settings": "Settings",
  "/tasks": "Inbox",
  "/tasks/today": "Today",
  "/tasks/upcoming": "Upcoming",
  "/tasks/completed": "Completed",
};

/** `titles` is the store's title version: a new title gives a new function, so labels follow it. */
function useTabLabel(store: Store, titles: number) {
  const { byNumber } = useAppData();
  return useCallback(
    (t: Tab): { label: string; issue: boolean } => {
      const url = currentUrl(t);
      const n = issueOfUrl(url);
      if (n != null) {
        const i = byNumber.get(n);
        return { label: i ? `#${n} ${i.title}` : `#${n}`, issue: true };
      }
      const path = url.split("?")[0]!;
      return { label: store.title(url) ?? PAGE_TITLES[path] ?? "Deska", issue: false };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `titles` stands for what store.title() returns
    [byNumber, store, titles],
  );
}

/** The strip above the content. Shown only with two or more tabs. */
export function TabStrip() {
  const store = useTabs();
  if (!store) return null;
  return <Strip store={store} />;
}

function Strip({ store }: { store: Store }) {
  const s = useTabsState(store);
  // Their own subscriptions: a flash or a new title leaves the tabs themselves unchanged.
  const flash = useSyncExternalStore(store.subscribe, store.flash, () => null);
  const titles = useSyncExternalStore(store.subscribe, store.titleVersion, () => 0);
  const label = useTabLabel(store, titles);
  const home = useTasksOnly() ? "/tasks" : "/my";
  const [lit, setLit] = useState<string | null>(null);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!flash || Date.now() - flash.at > 1000) return;
    setLit(flash.id);
    list.current?.querySelector(`[data-tab-id="${CSS.escape(flash.id)}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
    const t = setTimeout(() => setLit(null), 900);
    return () => clearTimeout(t);
  }, [flash]);
  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [s.active]);
  const labels = useMemo(() => new Map(s.tabs.map((t) => [t.id, label(t)])), [s.tabs, label]);
  const shown = s.tabs.length >= 2;
  // The side panels start below the strip, so they never cover it.
  useEffect(() => {
    if (!shown) return;
    const root = document.documentElement;
    root.style.setProperty("--tab-strip-h", "2.25rem");
    return () => {
      root.style.removeProperty("--tab-strip-h");
    };
  }, [shown]);
  if (!shown) return null;

  const focusTab = (i: number) => {
    const t = s.tabs[(i + s.tabs.length) % s.tabs.length]!;
    store.switchTo(t.id);
    requestAnimationFrame(() => list.current?.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(t.id)}"]`)?.focus());
  };

  return (
    <div className="flex h-9 shrink-0 items-end gap-1 px-1 pb-1 md:px-0" data-tab-strip>
      <div
        ref={list}
        role="tablist"
        aria-label="Open tabs"
        className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none]"
        onKeyDown={(e) => {
          const at = s.tabs.findIndex((t) => t.id === s.active);
          if (e.key === "ArrowRight") {
            e.preventDefault();
            focusTab(at + 1);
          } else if (e.key === "ArrowLeft") {
            e.preventDefault();
            focusTab(at - 1);
          } else if (e.key === "Delete" || e.key === "Backspace") {
            e.preventDefault();
            store.close(s.active);
          }
        }}
      >
        {s.tabs.map((t) => {
          const on = t.id === s.active;
          const { label: text, issue } = labels.get(t.id)!;
          return (
            <div
              key={t.id}
              role="tab"
              aria-selected={on}
              tabIndex={on ? 0 : -1}
              title={text}
              data-tab-id={t.id}
              data-flash={lit === t.id ? "" : undefined}
              onClick={() => store.switchTo(t.id)}
              onAuxClick={(e) => {
                if (e.button !== 1) return;
                e.preventDefault();
                store.close(t.id);
              }}
              onMouseDown={(e) => {
                if (e.button === 1) e.preventDefault();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  store.switchTo(t.id);
                }
              }}
              className={`group flex h-7 min-w-[7rem] max-w-[14rem] flex-1 cursor-default items-center gap-1.5 rounded-lg pl-2.5 pr-1 text-[12.5px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-focus ${
                on ? "border border-line bg-surface text-fg shadow-raised" : "border border-transparent text-muted hover:bg-hover hover:text-fg"
              } ${lit === t.id ? "ring-2 ring-brand-border" : ""}`}
            >
              <Icon name={issue ? "circleDot" : "layers"} size={12} className="shrink-0 text-faint" />
              <span className="min-w-0 flex-1 truncate">{text}</span>
              <button
                type="button"
                tabIndex={-1}
                aria-label={`Close ${text}`}
                title="Close tab (⌘W)"
                onClick={(e) => {
                  e.stopPropagation();
                  store.close(t.id);
                }}
                className={`grid size-5 shrink-0 place-items-center rounded text-faint hover:bg-active hover:text-fg ${on ? "" : "opacity-0 group-hover:opacity-100"}`}
              >
                <Icon name="x" size={12} />
              </button>
            </div>
          );
        })}
      </div>
      <button
        type="button"
        aria-label="New tab"
        title="New tab"
        onClick={() => store.open(home, true)}
        className="grid size-7 shrink-0 place-items-center rounded-lg text-faint hover:bg-hover hover:text-fg"
      >
        <Icon name="plus" size={14} />
      </button>
    </div>
  );
}
