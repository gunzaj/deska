"use client";

import { fetchPreloaded } from "@/lib/client/preload";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { shortAgo } from "@/lib/client/format";
import { localTime, localToday } from "@/lib/tasks/dates";
import type { AppNotification, Prefs, SidebarLayout } from "@/lib/tasks/model";
import { Icon, type IconName } from "../icons";
import { btn, Popover } from "../ui/popover";
import { openTask } from "./open-task";
import { useTasks } from "./store";
import { isUnauthorized } from "@/lib/client/session";
import { usePoll } from "@/lib/client/poll";

/**
 * In-app notifications and per-user settings (SPEC §12.6). Polls every 30 s
 * and on focus; the server fires due reminders on each poll. New entries also
 * raise a browser notification when the user opted in and allowed it.
 */
// Three contexts (v5 3.10): the list changes with every poll, the settings
// rarely, the clock once a minute. One object made all of them re-render
// together, and every `useToday()` caller ran its own timer.
type NotesCtx = {
  list: AppNotification[];
  unread: number;
  markRead: (ids: string[] | "all") => Promise<void>;
};

type PrefsCtx = {
  prefs: Prefs;
  /** The viewer's time zone: their setting, else the browser's. */
  tz: string;
  setPrefs: (p: Partial<Prefs>) => Promise<void>;
};

type Clock = { today: string; now: string; tz: string };

const Ctx = createContext<NotesCtx | null>(null);
const PrefsContext = createContext<PrefsCtx | null>(null);
const ClockContext = createContext<Clock | null>(null);

export function useNotifications(): NotesCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useNotifications outside NotificationsProvider");
  return c;
}

export function usePrefs(): PrefsCtx {
  const c = useContext(PrefsContext);
  if (!c) throw new Error("usePrefs outside NotificationsProvider");
  return c;
}

/** Today (YYYY-MM-DD) and the time now (HH:mm) in the viewer's zone, from the one shared clock. */
export function useToday(): Clock {
  const shared = useContext(ClockContext);
  const tz = useContext(PrefsContext)?.tz ?? browserTz();
  // Outside the provider (tests, isolated components) there is no clock to share.
  return shared ?? { today: localToday(new Date(), tz), now: localTime(new Date(), tz), tz };
}

/** The one clock: a single timer re-renders its readers once a minute, so "today" and due times roll over on their own. */
function ClockProvider({ tz, children }: { tz: string; children: ReactNode }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 60_000);
    return () => clearInterval(t);
  }, []);
  const value = useMemo<Clock>(() => {
    const d = new Date();
    return { today: localToday(d, tz), now: localTime(d, tz), tz };
    // `tick` is the reason to recompute: the minute moved.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, tz]);
  return <ClockContext.Provider value={value}>{children}</ClockContext.Provider>;
}

function browserTz(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

const POLL_MS = 30_000;

const KIND_TEXT: Record<AppNotification["kind"], { icon: IconName; text: (n: AppNotification) => string }> = {
  reminder: { icon: "clock", text: () => "Reminder" },
  assigned: { icon: "user", text: (n) => `${n.actor} assigned you` },
  completed: { icon: "circleCheck", text: (n) => `${n.actor} completed` },
  comment: { icon: "message", text: (n) => `${n.actor} commented on` },
  watch_digest: { icon: "star", text: () => "Watching" },
};

/** A task notification opens its task; the watchlist digest opens the Watching page (F6). */
function useOpenNotification() {
  const router = useRouter();
  return useCallback(
    (n: AppNotification) => {
      if (n.taskId) openTask(n.taskId);
      else router.push("/watching");
    },
    [router],
  );
}

const SIDEBAR_KEY = "deska-sidebar";
const TEAM_KEY = "deska-default-team";

function cacheTeam(team: string | null) {
  try {
    if (team) localStorage.setItem(TEAM_KEY, team);
    else localStorage.removeItem(TEAM_KEY);
  } catch {
    /* storage unavailable */
  }
}

function readCachedSidebar(): SidebarLayout | null {
  try {
    const raw = localStorage.getItem(SIDEBAR_KEY);
    return raw ? (JSON.parse(raw) as SidebarLayout) : null;
  } catch {
    return null;
  }
}

function cacheSidebar(layout: SidebarLayout | null) {
  try {
    if (layout) localStorage.setItem(SIDEBAR_KEY, JSON.stringify(layout));
    else localStorage.removeItem(SIDEBAR_KEY);
  } catch {
    /* storage blocked; the server copy still applies */
  }
}

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { reload } = useTasks();
  const openNotification = useOpenNotification();
  const [list, setList] = useState<AppNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [prefs, setPrefsState] = useState<Prefs>({ tz: null, browserNotifications: false, sidebar: null, defaultTeam: null });
  // The latest list and count, for the mark-read rollback.
  const listRef = useRef(list);
  listRef.current = list;
  const unreadRef = useRef(unread);
  unreadRef.current = unread;
  const seen = useRef<Set<string> | null>(null);
  const prefsRef = useRef(prefs);
  const edited = useRef<Partial<Prefs>>({});
  prefsRef.current = prefs;
  // Focus and visibilitychange fire together, and marking read races a poll
  // already on its way: only the newest poll may apply, and a mark-read
  // invalidates older ones so they can't bring the unread dot back.
  const pollSeq = useRef(0);

  const poll = useCallback(async () => {
    const seq = ++pollSeq.current;
    try {
      const res = await fetchPreloaded("/api/notifications", { cache: "no-store" });
      if (isUnauthorized(res) || !res.ok) return;
      const body = (await res.json()) as { list: AppNotification[]; unread: number };
      if (seq !== pollSeq.current) return;
      const fresh = seen.current ? body.list.filter((n) => !seen.current!.has(n.id) && !n.readAt) : [];
      seen.current = new Set(body.list.map((n) => n.id));
      setList(body.list);
      setUnread(body.unread);
      if (fresh.length) {
        // Someone assigned or completed something: refresh the task list too.
        if (fresh.some((n) => n.kind !== "reminder" && n.kind !== "watch_digest")) void reload();
        if (prefsRef.current.browserNotifications && typeof Notification !== "undefined" && Notification.permission === "granted") {
          for (const n of fresh.slice(0, 3)) {
            const note = new Notification(`${KIND_TEXT[n.kind].text(n)}: ${n.title}`, { tag: n.id, body: "Deska" });
            note.onclick = () => {
              window.focus();
              openNotification(n);
            };
          }
        }
      }
    } catch {
      /* offline; try again next tick */
    }
  }, [reload, openNotification]);

  // The sidebar layout is cached locally so a hidden section doesn't flash in before prefs load.
  useLayoutEffect(() => {
    const cached = readCachedSidebar();
    if (cached) setPrefsState((x) => ({ ...x, sidebar: cached }));
    // The default Team too, so lists don't show unfiltered for a moment.
    try {
      const team = localStorage.getItem(TEAM_KEY);
      if (team) setPrefsState((x) => ({ ...x, defaultTeam: team }));
    } catch {
      /* storage unavailable */
    }
  }, []);

  useEffect(() => {
    void (async () => {
      const res = await fetchPreloaded("/api/me/prefs", { cache: "no-store" }).catch(() => null);
      if (!res?.ok) return;
      const p = (await res.json()) as Prefs;
      // Settings changed here while this was loading win over what the server said.
      setPrefsState({ ...p, ...edited.current });
      cacheSidebar(p.sidebar);
      cacheTeam(p.defaultTeam ?? null);
      // First visit: remember the browser's zone so reminders use it server-side.
      if (!p.tz) {
        const tz = browserTz();
        await fetch("/api/me/prefs", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ tz }) }).catch(() => null);
        setPrefsState((x) => ({ ...x, tz }));
      }
    })();
  }, []);

  // Visibility and focus fire together when a tab returns: one poll, not two.
  usePoll(poll, { every: POLL_MS });

  const markRead = useCallback(async (ids: string[] | "all") => {
    pollSeq.current++;
    const before = { list: listRef.current, unread: unreadRef.current };
    const now = new Date().toISOString();
    // Only already-unread entries lower the count: clicking a read one must not.
    const unreadIds =
      ids === "all"
        ? listRef.current.filter((n) => !n.readAt).map((n) => n.id)
        : ids.filter((id) => !listRef.current.find((n) => n.id === id)?.readAt);
    setList((prev) => prev.map((n) => (ids === "all" || ids.includes(n.id) ? { ...n, readAt: n.readAt ?? now } : n)));
    setUnread((u) => (ids === "all" ? 0 : Math.max(0, u - unreadIds.length)));
    const res = await fetch("/api/notifications/read", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(ids === "all" ? { all: true } : { ids }) }).catch(() => null);
    if (!res?.ok) {
      // Not marked: restore the list and the count rather than leave them wrong.
      setList(before.list);
      setUnread(before.unread);
    }
    pollSeq.current++;
  }, []);

  const setPrefs = useCallback(async (p: Partial<Prefs>) => {
    const before = prefsRef.current;
    edited.current = { ...edited.current, ...p };
    setPrefsState((x) => ({ ...x, ...p }));
    if (p.sidebar !== undefined) cacheSidebar(p.sidebar);
    if (p.defaultTeam !== undefined) cacheTeam(p.defaultTeam);
    const res = await fetch("/api/me/prefs", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(p) }).catch(() => null);
    if (res?.ok) return;
    // Not saved: put the changed settings back rather than show a setting that won't stick.
    for (const k of Object.keys(p)) delete edited.current[k as keyof Prefs];
    const undo = Object.fromEntries(Object.keys(p).map((k) => [k, before[k as keyof Prefs]])) as Partial<Prefs>;
    setPrefsState((x) => ({ ...x, ...undo }));
    if (undo.sidebar !== undefined) cacheSidebar(undo.sidebar);
    if (undo.defaultTeam !== undefined) cacheTeam(undo.defaultTeam);
  }, []);

  const value = useMemo<NotesCtx>(() => ({ list, unread, markRead }), [list, unread, markRead]);
  const tz = prefs.tz ?? browserTz();
  const prefsValue = useMemo<PrefsCtx>(() => ({ prefs, tz, setPrefs }), [prefs, tz, setPrefs]);
  return (
    <PrefsContext.Provider value={prefsValue}>
      <ClockProvider tz={tz}>
        <Ctx.Provider value={value}>{children}</Ctx.Provider>
      </ClockProvider>
    </PrefsContext.Provider>
  );
}

/** Sidebar bell with unread count and the notification list. */
export function NotificationBell() {
  const { list, unread, markRead } = useNotifications();
  const openNotification = useOpenNotification();
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        ref={anchor}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
        title="Notifications"
        className="relative grid size-7 place-items-center rounded-md text-muted hover:bg-hover hover:text-fg"
      >
        <Icon name="bell" size={15} />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-[var(--prio-1)] px-1 text-[10px] font-semibold tabular-nums text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>
      <Popover anchor={anchor} open={open} onClose={() => setOpen(false)} width={340}>
        <div className="flex items-center gap-2 border-b border-line px-3 py-2">
          <p className="flex-1 text-[13px] font-semibold">Notifications</p>
          {unread > 0 && (
            <button type="button" onClick={() => void markRead("all")} className={btn.ghost}>
              Mark all read
            </button>
          )}
        </div>
        <div className="max-h-[60vh] overflow-y-auto p-1" role="list" aria-label="Notifications">
          {list.length === 0 && <p className="px-3 py-6 text-center text-[12.5px] text-faint">Nothing yet. Reminders, assignments, completions, comments and changes on what you watch show up here.</p>}
          {list.map((n) => (
            <button
              key={n.id}
              type="button"
              role="listitem"
              onClick={() => {
                void markRead([n.id]);
                setOpen(false);
                openNotification(n);
              }}
              className={`flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-hover ${n.readAt ? "" : "bg-[var(--info-soft)]/40"}`}
            >
              <Icon name={KIND_TEXT[n.kind].icon} size={14} className="mt-0.5 text-faint" />
              <span className="min-w-0 flex-1">
                <span className="block text-[12px] text-muted">{KIND_TEXT[n.kind].text(n)}</span>
                <span className="block truncate text-[13px]">{n.title}</span>
              </span>
              <span className="shrink-0 text-[11px] text-faint">{shortAgo(n.createdAt)}</span>
              {!n.readAt && <span aria-label="Unread" className="mt-1.5 size-1.5 shrink-0 rounded-full bg-[var(--info)]" />}
            </button>
          ))}
        </div>
        <NotificationSettings />
      </Popover>
    </>
  );
}

/** Time zone and browser notifications, at the bottom of the bell popover. */
function NotificationSettings() {
  const { prefs, setPrefs, tz } = usePrefs();
  const zones = useMemo(() => {
    try {
      return (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? [tz];
    } catch {
      return [tz];
    }
  }, [tz]);
  const permission = typeof Notification === "undefined" ? "unsupported" : Notification.permission;
  const toggleBrowser = async () => {
    if (prefs.browserNotifications) return setPrefs({ browserNotifications: false });
    if (typeof Notification === "undefined") return;
    const p = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
    await setPrefs({ browserNotifications: p === "granted" });
  };
  return (
    <div className="space-y-2 border-t border-line px-3 py-2.5 text-[12.5px]">
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={prefs.browserNotifications} onChange={() => void toggleBrowser()} disabled={permission === "unsupported" || permission === "denied"} />
        <span className="flex-1">Browser notifications while Deska is open</span>
      </label>
      {permission === "denied" && <p className="text-[11.5px] text-faint">Blocked in this browser&apos;s site settings. The bell keeps working.</p>}
      <label className="flex items-center gap-2">
        <span className="shrink-0 text-muted">Time zone</span>
        <select value={tz} onChange={(e) => void setPrefs({ tz: e.target.value })} className="h-7 min-w-0 flex-1 rounded-md border border-line bg-surface px-1.5 text-[12px] outline-none" aria-label="Time zone">
          {zones.map((z) => (
            <option key={z} value={z}>
              {z}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
