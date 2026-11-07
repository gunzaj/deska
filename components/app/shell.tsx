"use client";

import { usePathname } from "next/navigation";
import { Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { Icon, Logo } from "../icons";
import { EditsProvider } from "../issue/edits";
import { IssuePeek } from "../issue/peek";
import { ComposeTask } from "../tasks/compose";
import { TaskPeek } from "../tasks/panel";
import { SnoozeProvider } from "../triage/snoozes";
import { WatchProvider } from "../watch/store";
import { DefaultScopeProvider } from "./team-scope";
import { NotificationsProvider } from "../tasks/notifications";
import { TasksProvider } from "../tasks/store";
import { useAppData } from "./provider";
import { CommandPalette } from "./palette";
import { PanelDismiss } from "./panel-dismiss";
import { GlobalShortcuts } from "./shortcuts";
import { Sidebar } from "./sidebar";
import { StatusBanners } from "./status-banner";
import { ConnectionBanner, ConnectionProvider } from "./connection";
import { useTasksOnly } from "./tasks-only";

/**
 * Linear-style frame: a quiet sidebar on the page colour and the content in an
 * inset raised panel. On narrow screens the sidebar becomes a drawer.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const [drawer, setDrawer] = useState(false);
  const path = usePathname();
  const tasksOnly = useTasksOnly();
  useEffect(() => setDrawer(false), [path]);

  return (
    <ConnectionProvider>
      <EditsProvider>
        <TasksProvider>
          <NotificationsProvider>
            <SnoozeProvider>
            <DefaultScopeProvider>
            <WatchProvider>
            <div className="flex h-dvh overflow-hidden">
              <aside className="hidden w-[232px] shrink-0 md:block">
                <Sidebar />
              </aside>

              {drawer && (
                <MobileDrawer onClose={() => setDrawer(false)}>
                  <Sidebar onNavigate={() => setDrawer(false)} />
                </MobileDrawer>
              )}

              <div className="flex min-w-0 flex-1 flex-col md:py-2 md:pr-2">
                <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-3 md:hidden">
                  <button type="button" aria-label="Open menu" onClick={() => setDrawer(true)} className="grid size-8 place-items-center rounded-md hover:bg-hover">
                    <Icon name="sidebar" size={16} />
                  </button>
                  <Logo size={20} />
                  <span className="font-semibold">Deska</span>
                </div>
                <main className="flex min-h-0 flex-1 flex-col overflow-hidden bg-surface md:rounded-xl md:border md:border-line md:shadow-raised">
                  <StatusBanners />
                  {!tasksOnly && <ConnectionBanner />}
                  {!tasksOnly && <SampleBanner />}
                  {children}
                </main>
              </div>
              <Suspense>
                <IssuePeek />
                <TaskPeek />
                <PanelDismiss />
              </Suspense>
              <ComposeTask />
              <CommandPalette />
              <GlobalShortcuts />
            </div>
            </WatchProvider>
            </DefaultScopeProvider>
            </SnoozeProvider>
          </NotificationsProvider>
        </TasksProvider>
      </EditsProvider>
    </ConnectionProvider>
  );
}

/**
 * The narrow-screen menu drawer: a dialog that moves focus in on open, traps
 * Tab, closes on Escape and returns focus to the opener on close.
 */
function MobileDrawer({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const node = ref.current;
    const focusables = () =>
      Array.from(node?.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input,select,textarea,[tabindex]:not([tabindex="-1"])') ?? []).filter((el) => el.offsetParent !== null);
    (focusables()[0] ?? node)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const f = focusables();
      if (!f.length) return;
      const first = f[0]!;
      const last = f[f.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      prev?.focus?.();
    };
  }, []);
  return (
    <div className="fixed inset-0 z-40 md:hidden">
      <button type="button" aria-label="Close menu" className="anim-fade absolute inset-0 bg-underlay" onClick={onClose} />
      <div ref={ref} role="dialog" aria-modal="true" aria-label="Menu" className="anim-slide absolute inset-y-0 left-0 w-[264px] bg-bg shadow-modal">
        {children}
      </div>
    </div>
  );
}

/** Shown whenever the app is rendering the generated preview instead of a synced cache. */
function SampleBanner() {
  const { data } = useAppData();
  if (!data.meta.demo) return null;
  return (
    <p className="shrink-0 border-b border-line bg-banner-warning px-3 py-1.5 text-[12.5px] text-warning">
      Sample data. Titles, numbers, and assignees on this preview are generated in Deska.
    </p>
  );
}

/** Standard page frame: header row (title + actions), optional toolbar, scrolling body. */
export function Page({
  title,
  icon,
  actions,
  toolbar,
  summary,
  children,
}: {
  title: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  toolbar?: ReactNode;
  /** A line of facts under the header, for what the header has no room for on a phone. */
  summary?: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-4">
        {icon && <span className="text-faint">{icon}</span>}
        <h1 className="min-w-0 flex-1 truncate text-[14px] font-semibold">{title}</h1>
        {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
      </header>
      {summary}
      {toolbar && <div className="shrink-0 border-b border-line px-3 py-2">{toolbar}</div>}
      <div className="relative min-h-0 flex-1 overflow-auto">{children}</div>
    </>
  );
}
