"use client";

import Link from "next/link";
import { HELP_EVENT } from "./palette";
import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, useId, useMemo, useState, type DragEvent, type ReactNode } from "react";
import { longAgo, plainName } from "@/lib/client/format";
import { syncWarning, syncWarningTitle } from "@/lib/client/sync-health";
import { Icon, Logo, type IconName } from "../icons";
import { Kbd, OptionDot } from "../props";
import { useTriageCount } from "../triage/queues";
import { useTasks } from "../tasks/store";
import { RambleDialog } from "../tasks/ramble";
import { SaveTaskViewDialog } from "../tasks/task-views";
import { useTaskDrop } from "../tasks/drop";
import type { DropTarget } from "@/lib/client/task-drop";
import { arrangeSidebar, CURRENT_KEY, dropItem, NAV_DRAG_TYPE, toggleFavorite, type SidebarList } from "@/lib/client/sidebar-items";
import { useWatchlist } from "../watch/store";
import { useDefaultScope } from "./team-scope";
import { primaryDimension, sprintOn } from "@/lib/client/explorer";
import { UserMenu } from "./user-menu";
import { GITHUB_SECTIONS, SIDEBAR_SECTIONS, type SidebarSection } from "@/lib/tasks/model";
import { ColorDot, NewLabelDialog, ProjectDialog } from "../tasks/organize";
import { sidebarCounts } from "@/lib/tasks/counts";
import { NotificationBell, useToday } from "../tasks/notifications";
import { PALETTE_EVENT } from "./palette";
import { openCreateIssue } from "../issue/create-issue";
import { useAppData, useAppSync, useAppViews } from "./provider";
import { useConnection } from "./connection";
import { useTasksOnly } from "./tasks-only";
import { CUSTOMIZE_SIDEBAR_EVENT, CustomizeSidebarDialog, useSidebarLayout } from "./sidebar-customize";

/** One sidebar link. `home` is the section it belongs to while it is not a favorite. */
type NavItem = {
  key: string;
  home: SidebarSection;
  href: string;
  label: string;
  icon?: IconName;
  /** A colored dot instead of an icon (projects, labels, the dimension's options). */
  dot?: ReactNode;
  count?: number;
  match?: (p: string) => boolean;
  /** Dropping a task here files, schedules or labels it. */
  drop?: DropTarget;
};

type DragItem = { key: string; home: SidebarSection; from: SidebarList };
type DropAt = { list: SidebarList; key: string | null; after: boolean };

/** Dragging sidebar items to reorder them, and the star that makes one a favorite. */
const NavDndContext = createContext<{
  drag: DragItem | null;
  over: DropAt | null;
  start: (d: DragItem) => void;
  hover: (at: DropAt) => void;
  drop: (at: DropAt) => void;
  end: () => void;
  toggle: (key: string) => void;
} | null>(null);

function useNavDnd() {
  const c = useContext(NavDndContext);
  if (!c) throw new Error("sidebar row outside the sidebar");
  return c;
}

const isNavDrag = (e: DragEvent) => e.dataTransfer.types.includes(NAV_DRAG_TYPE);
const lowerHalf = (e: DragEvent) => {
  const r = e.currentTarget.getBoundingClientRect();
  return e.clientY > r.top + r.height / 2;
};
const dropLine = "pointer-events-none absolute inset-x-1 z-10 h-0.5 rounded-full bg-[var(--brand-border)]";

export function openPalette() {
  window.dispatchEvent(new CustomEvent(PALETTE_EVENT));
}

/** A sidebar link: drag it to reorder its list or onto Favorites; the star adds it to Favorites or takes it out. */
function NavRow({ item, list, onNavigate }: { item: NavItem; list: SidebarList; onNavigate?: () => void }) {
  const path = usePathname();
  const active = item.match ? item.match(path) : path === item.href || path.startsWith(`${item.href}/`);
  const drop = useTaskDrop(item.drop ?? { kind: "inbox" });
  const dnd = useNavDnd();
  const favorite = list === "favorites";
  const labelId = useId();
  // An item moves inside its own list, into Favorites, or from Favorites back to its section.
  const accepts = (e: DragEvent) => Boolean(dnd.drag) && isNavDrag(e) && (favorite || list === dnd.drag!.home);
  const line = dnd.over?.list === list && dnd.over.key === item.key ? (dnd.over.after ? "after" : "before") : null;
  return (
    <div
      className="group/row relative"
      data-nav-item={item.key}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(NAV_DRAG_TYPE, item.key);
        e.dataTransfer.effectAllowed = "move";
        dnd.start({ key: item.key, home: item.home, from: list });
      }}
      onDragEnd={dnd.end}
      onDragOver={(e) => {
        if (!accepts(e)) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = "move";
        dnd.hover({ list, key: item.key, after: lowerHalf(e) });
      }}
      onDrop={(e) => {
        if (!accepts(e)) return;
        e.preventDefault();
        e.stopPropagation();
        dnd.drop({ list, key: item.key, after: lowerHalf(e) });
      }}
    >
      {line && <span aria-hidden className={`${dropLine} ${line === "after" ? "-bottom-px" : "-top-px"}`} />}
      <Link
        href={item.href}
        onClick={onNavigate}
        draggable={false}
        aria-current={active ? "page" : undefined}
        {...(item.drop ? drop.handlers : {})}
        data-drop-target={item.drop?.kind}
        className={`flex h-7 items-center gap-2 rounded-md px-2 text-[13px] font-medium transition-colors ${
          active ? "bg-active text-fg" : "text-muted hover:bg-hover hover:text-fg"
        } ${item.drop && drop.over ? "ring-2 ring-brand-border bg-brand-soft" : ""} ${dnd.drag?.key === item.key ? "opacity-50" : ""}`}
      >
        {item.icon ? (
          <Icon name={item.icon} size={15} className={active ? "text-fg" : "text-faint group-hover/row:text-muted"} />
        ) : (
          <span className="grid size-[15px] shrink-0 place-items-center">{item.dot}</span>
        )}
        <span id={labelId} className="min-w-0 flex-1 truncate">{item.label}</span>
        {/* The star takes the count's place while the row is hovered. */}
        {item.count != null && item.count > 0 && (
          <span className="text-[11px] tabular-nums text-faint group-hover/row:invisible group-has-[button:focus-visible]/row:invisible">{item.count.toLocaleString()}</span>
        )}
      </Link>
      <button
        type="button"
        onClick={() => dnd.toggle(item.key)}
        aria-pressed={favorite}
        // The name is the same on every row and the row's label describes it: an item can be called anything,
        // and a name with the label in it would answer to "Backlog" or "Add section" as the page's own buttons do.
        aria-label={favorite ? "Unfavorite" : "Favorite"}
        aria-describedby={labelId}
        title={favorite ? "Remove from favorites" : "Add to favorites"}
        className="absolute right-1 top-1 grid size-5 place-items-center rounded text-faint opacity-0 hover:bg-active hover:text-fg focus-visible:opacity-100 group-hover/row:opacity-100"
      >
        <Icon name="star" size={12} fill={favorite ? "currentColor" : "none"} />
      </button>
    </div>
  );
}

/** The rows of one list. A drop below the last row (or on an empty list) puts the item at the end. */
function NavList({ list, items, onNavigate, children }: { list: SidebarList; items: NavItem[]; onNavigate?: () => void; children?: ReactNode }) {
  const dnd = useNavDnd();
  const accepts = (e: DragEvent) => Boolean(dnd.drag) && isNavDrag(e) && (list === "favorites" || list === dnd.drag!.home);
  return (
    <div
      className="relative space-y-px"
      data-nav-list={list}
      onDragOver={(e) => {
        if (!accepts(e)) return;
        e.preventDefault();
        dnd.hover({ list, key: null, after: true });
      }}
      onDrop={(e) => {
        if (!accepts(e)) return;
        e.preventDefault();
        dnd.drop({ list, key: null, after: true });
      }}
    >
      {items.map((item) => (
        <NavRow key={item.key} item={item} list={list} onNavigate={onNavigate} />
      ))}
      {children}
      {dnd.over?.list === list && dnd.over.key === null && <span aria-hidden className={`${dropLine} -bottom-px`} />}
    </div>
  );
}

/** An archived project: a plain link, not a drop target and not reorderable. */
function ArchivedLink({ href, label, color, onNavigate }: { href: string; label: string; color: string; onNavigate?: () => void }) {
  const active = usePathname() === href;
  return (
    <Link href={href} onClick={onNavigate} aria-current={active ? "page" : undefined} className={`flex h-7 items-center gap-2 rounded-md px-2 text-[13px] font-medium ${active ? "bg-active text-fg" : "text-muted hover:bg-hover hover:text-fg"}`}>
      <span className="grid size-[15px] place-items-center">
        <ColorDot color={color} size={8} />
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </Link>
  );
}

/** A sidebar section (Favorites, Tasks, Projects, Labels, GitHub, Views, the dimension): a collapsible heading and its rows. */
function Section({ title, children, action, first }: { title: string; children: React.ReactNode; action?: React.ReactNode; first?: boolean }) {
  const [open, setOpen] = useState(true);
  return (
    <div className={first ? "" : "mt-3"} role="group" aria-label={title} data-sidebar-section={title}>
      <div className="group flex h-6 items-center px-2">
        <h2 className="flex flex-1">
          <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex flex-1 items-center gap-1 text-[11.5px] font-medium text-faint hover:text-muted">
            {title}
            <Icon name={open ? "chevronDown" : "chevronRight"} size={12} className="opacity-0 group-hover:opacity-100" />
          </button>
        </h2>
        {action}
      </div>
      {open && <div className="mt-0.5 space-y-px">{children}</div>}
    </div>
  );
}

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const tasksOnly = useTasksOnly();
  const { data, viewer } = useAppData();
  const { views, taskViews } = useAppViews();
  const { sync, syncNow } = useAppSync();
  const { meta, issues } = data;
  const { scope } = useDefaultScope();
  const sprints = sprintOn(meta);
  const dim = primaryDimension(meta);
  const syncWarn = meta.demo || sync.needsInitialImport ? null : syncWarning(sync);
  // Offline or a refused token: the rows are the cached ones, as of the last sync (§3.3).
  const connectionState = useConnection().status?.state;
  const stale = !meta.demo && (connectionState === "offline" || connectionState === "invalid");

  const counts = useMemo(() => {
    const me = viewer.toLowerCase();
    let mine = 0;
    let backlog = 0;
    for (const i of issues) {
      if (i.state !== "open") continue;
      if (i.assignees.some((a) => a.toLowerCase() === me)) mine++;
      // The backlog opens filtered to the default value, so its count does too.
      if (!i.releaseId && (!scope || i.dims[scope.dimension.id]?.id === scope.optionId)) backlog++;
    }
    return { mine, backlog };
  }, [issues, viewer, scope]);

  const { tasks, projects, labels, openCompose } = useTasks();
  const { today } = useToday();
  const [newProject, setNewProject] = useState(false);
  const [newLabel, setNewLabel] = useState(false);
  const [saveView, setSaveView] = useState(false);
  const [ramble, setRamble] = useState(false);
  const { layout, sections, saveItems } = useSidebarLayout();
  const [customize, setCustomize] = useState(false);
  const inDrawer = Boolean(onNavigate);
  useEffect(() => {
    // The desktop sidebar stays mounted (hidden) on mobile and answers the
    // palette; the drawer copy listening too would open a second dialog.
    if (inDrawer) return;
    const show = () => setCustomize(true);
    window.addEventListener(CUSTOMIZE_SIDEBAR_EVENT, show);
    return () => window.removeEventListener(CUSTOMIZE_SIDEBAR_EVENT, show);
  }, [inDrawer]);
  const taskCounts = useMemo(() => sidebarCounts(tasks, projects, today), [tasks, projects, today]);
  const current = meta.releases.find((r) => r.id === meta.currentReleaseId);
  const triage = useTriageCount();
  const { unseen: watchUnseen } = useWatchlist();
  const projectKey = (id: string) => `/tasks/p/${id}`;
  const page = (home: SidebarSection, href: string, label: string, icon: IconName, more: Partial<NavItem> = {}): NavItem => ({ key: href, home, href, label, icon, ...more });
  // In each section's default order. Home and the three issue lists belong to the GitHub lists
  // (HOME-SPEC §2.4); without GitHub, Home sits with the task lists so unstarring it cannot lose it.
  const taskItems: NavItem[] = [
    ...(tasksOnly ? [page("tasks", "/home", "Home", "home")] : []),
    page("tasks", "/tasks", "Inbox", "inbox", { count: taskCounts.inbox, match: (p) => p === "/tasks", drop: { kind: "inbox" } }),
    page("tasks", "/tasks/today", "Today", "star", { count: taskCounts.due, drop: { kind: "today" } }),
    page("tasks", "/tasks/upcoming", "Upcoming", "calendar", { drop: { kind: "upcoming" } }),
    page("tasks", "/tasks/completed", "Completed", "circleCheck"),
    // Saved task views (item 12) come after the four built-in lists.
    ...taskViews.map((v) => page("tasks", `/tasks/views/${v.id}`, v.name, "sliders")),
    ...projects
      .filter((p) => !p.archived)
      .map((p): NavItem => ({ key: projectKey(p.id), home: "projects", href: projectKey(p.id), label: p.name, dot: <ColorDot color={p.color} size={8} />, count: taskCounts.perProject.get(p.id), drop: { kind: "project", id: p.id, name: p.name } })),
    ...labels.map((l): NavItem => ({ key: `/tasks/l/${l.id}`, home: "labels", href: `/tasks/l/${l.id}`, label: l.name, dot: <ColorDot color={l.color} size={8} shape="tag" />, count: taskCounts.perLabel.get(l.id), drop: { kind: "label", name: l.name } })),
  ];
  const githubItems: NavItem[] = [
    page("workspace", "/home", "Home", "home"),
    page("workspace", "/triage", "Triage", "inbox", { count: triage }),
    page("workspace", "/my", "My issues", "user", { count: counts.mine }),
    page("workspace", "/watching", "Watching", "star", { count: watchUnseen }),
    page("workspace", "/issues", "All issues", "layers", { match: (p) => p === "/issues" }),
    // Sprint features show only with a mapped Sprint field (§4.1).
    ...(sprints
      ? [
          page("workspace", "/backlog", "Backlog", "list", { count: counts.backlog }),
          page("workspace", "/releases", "Releases", "rocket", { match: (p) => p === "/releases" }),
          ...(current ? [page("workspace", `/releases/${current.id}`, `Current · ${current.title}`, "calendar", { key: CURRENT_KEY })] : []),
        ]
      : []),
    page("workspace", "/epics", "Epics", "epic"),
    page("workspace", "/insights", "Insights", "chart"),
    ...views.map((v) => page("views", `/views/${v.id}`, v.name, v.layout === "board" ? "board" : v.layout === "table" ? "table" : "list")),
    ...(dim?.options ?? []).map((t): NavItem => ({ key: `/teams/${t.id}`, home: "teams", href: `/teams/${t.id}`, label: plainName(t.name) || t.name, dot: <OptionDot color={t.color} size={8} /> })),
  ];
  // The GitHub pages need GitHub data: in tasks-only mode they are not shown, starred or not.
  const items = tasksOnly ? taskItems : [...githubItems, ...taskItems];
  const lists = arrangeSidebar(items, layout);
  const rows = (id: SidebarSection) => lists.sections[id] ?? [];

  // Everything a stored key can still point at, shown now or not (the other mode's pages, archived projects).
  const known = new Set([...taskItems, ...githubItems].map((i) => i.key).concat(projects.map((p) => projectKey(p.id))));
  const exists = (key: string) => known.has(key);
  const shown = () => ({
    favorites: lists.favorites.map((i) => i.key),
    sections: Object.fromEntries(SIDEBAR_SECTIONS.map((id) => [id, rows(id).map((i) => i.key)])) as Record<SidebarSection, string[]>,
  });
  const [drag, setDrag] = useState<DragItem | null>(null);
  const [over, setOver] = useState<DropAt | null>(null);
  const endDrag = () => {
    setDrag(null);
    setOver(null);
  };
  const dnd = {
    drag,
    over,
    start: setDrag,
    // Dragover fires many times a second: keep the same state while the line has not moved.
    hover: (at: DropAt) => setOver((o) => (o && o.list === at.list && o.key === at.key && o.after === at.after ? o : at)),
    drop: (at: DropAt) => {
      const change = drag && dropItem(layout, shown(), drag, { list: at.list, target: at.key, after: at.after }, exists);
      endDrag();
      if (change) void saveItems(change);
    },
    end: endDrag,
    toggle: (key: string) => void saveItems(toggleFavorite(layout, shown().favorites, key, exists)),
  };

  /** The Tasks heading carries the task actions. */
  const taskActions = (
    <>
      <button type="button" onClick={() => setRamble(true)} title="Ramble: speak your tasks" aria-label="Ramble" className="grid size-5 place-items-center rounded text-faint hover:bg-hover hover:text-fg">
        <Icon name="mic" size={13} />
      </button>
      <button type="button" onClick={() => setSaveView(true)} title="Save view" aria-label="Save view" className="grid size-5 place-items-center rounded text-faint hover:bg-hover hover:text-fg">
        <Icon name="sliders" size={13} />
      </button>
      <button type="button" onClick={() => openCompose()} title="New task" aria-label="New task" className="grid size-5 place-items-center rounded text-faint hover:bg-hover hover:text-fg">
        <Icon name="plus" size={13} />
      </button>
    </>
  );

  const blocks: Record<SidebarSection, React.ReactNode> = {
    tasks: (
      <Section key="tasks" title="Tasks" action={taskActions}>
        <NavList list="tasks" items={rows("tasks")} onNavigate={onNavigate} />
      </Section>
    ),
    projects: (
      <Section
        key="projects"
        title="Projects"
        action={
          <button type="button" onClick={() => setNewProject(true)} title="New project" aria-label="New project" className="grid size-5 place-items-center rounded text-faint hover:bg-hover hover:text-fg">
            <Icon name="plus" size={13} />
          </button>
        }
      >
        <NavList list="projects" items={rows("projects")} onNavigate={onNavigate} />
        {projects.every((p) => p.archived) && <p className="px-2 py-1 text-[12px] text-faint">No projects yet</p>}
        {projects.some((p) => p.archived) && (
          <details className="px-2 text-[12px] text-faint">
            <summary className="cursor-pointer py-1 hover:text-muted">Archived</summary>
            {projects
              .filter((p) => p.archived)
              .map((p) => (
                <ArchivedLink key={p.id} href={projectKey(p.id)} label={p.name} color={p.color} onNavigate={onNavigate} />
              ))}
          </details>
        )}
      </Section>
    ),
    labels: (
      <Section
        key="labels"
        title="Labels"
        action={
          <button type="button" onClick={() => setNewLabel(true)} title="New label" aria-label="New label" className="grid size-5 place-items-center rounded text-faint hover:bg-hover hover:text-fg">
            <Icon name="plus" size={13} />
          </button>
        }
      >
        <NavList list="labels" items={rows("labels")} onNavigate={onNavigate} />
        {labels.length === 0 && <p className="px-2 py-1 text-[12px] text-faint">No labels yet</p>}
      </Section>
    ),
    workspace: (
      <Section key="workspace" title="GitHub">
        <NavList list="workspace" items={rows("workspace")} onNavigate={onNavigate} />
      </Section>
    ),
    views: (
      <Section
        key="views"
        title="Views"
        action={
          <Link href="/views/new" onClick={onNavigate} title="New view" aria-label="New view" className="grid size-5 place-items-center rounded text-faint hover:bg-hover hover:text-fg">
            <Icon name="plus" size={13} />
          </Link>
        }
      >
        <NavList list="views" items={rows("views")} onNavigate={onNavigate} />
        {views.length === 0 && <p className="px-2 py-1 text-[12px] text-faint">No views yet</p>}
      </Section>
    ),
    teams: (
      <Section key="teams" title={dim?.name ?? "Dimensions"}>
        {!dim && <p className="px-2 py-1 text-[12px] text-faint">No dimension mapped</p>}
        <NavList list="teams" items={rows("teams")} onNavigate={onNavigate} />
      </Section>
    ),
  };

  return (
    <div className="flex h-full flex-col px-2.5 pb-2.5 pt-3">
      <div className="flex items-center gap-2 px-1.5">
        <Logo size={22} />
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-[13.5px] font-semibold tracking-tight" title={tasksOnly ? "Deska" : meta.projectTitle || "Deska"}>
            {tasksOnly ? "Deska" : meta.projectTitle || "Deska"}
          </p>
          <p className="truncate text-[11px] text-faint" title={tasksOnly ? "Tasks" : meta.repo}>
            {tasksOnly ? "Tasks" : meta.repo}
          </p>
        </div>
        {!tasksOnly && (
          <button
            type="button"
            onClick={() => openCreateIssue()}
            title={meta.writeMode ? "New issue" : (meta.editOffReason ?? "Editing is off for this deployment")}
            aria-label="New issue"
            data-new-issue
            className="grid size-7 place-items-center rounded-md text-muted hover:bg-hover hover:text-fg"
          >
            <Icon name="plus" size={15} />
          </button>
        )}
        <NotificationBell />
      </div>

      <button
        type="button"
        onClick={openPalette}
        className="mt-3 flex h-8 items-center gap-2 rounded-lg border border-line bg-surface px-2.5 text-left text-muted shadow-raised transition-colors hover:border-line-field"
      >
        <Icon name="search" size={14} className="text-faint" />
        <span className="flex-1">Search or jump to…</span>
        <Kbd>⌘K</Kbd>
      </button>

      <nav
        aria-label="Main"
        className="mt-3 min-h-0 flex-1 overflow-y-auto pr-0.5"
        onDragLeave={(e) => {
          // The pointer left the sidebar: no list would take the drop.
          if (!(e.relatedTarget instanceof Node) || !e.currentTarget.contains(e.relatedTarget)) setOver(null);
        }}
      >
        <NavDndContext.Provider value={dnd}>
          <Section title="Favorites" first>
            <NavList list="favorites" items={lists.favorites} onNavigate={onNavigate}>
              {lists.favorites.length === 0 && <p className="px-2 py-1 text-[12px] text-faint">Star a page, or drag it here, to keep it on top</p>}
            </NavList>
          </Section>

          {/* The sections in the viewer's own order (Customize). The GitHub ones need GitHub data. */}
          {sections.filter((x) => !x.hidden && !(tasksOnly && GITHUB_SECTIONS.includes(x.id))).map((x) => blocks[x.id])}
        </NavDndContext.Provider>
        <ProjectDialog open={newProject} onClose={() => setNewProject(false)} />
        <NewLabelDialog open={newLabel} onClose={() => setNewLabel(false)} />
        <SaveTaskViewDialog open={saveView} onClose={() => setSaveView(false)} />
        <RambleDialog open={ramble} onClose={() => setRamble(false)} />
        <CustomizeSidebarDialog open={customize} onClose={() => setCustomize(false)} />
      </nav>

      <div className="mt-2 space-y-1.5 border-t border-line pt-2.5">
        {tasksOnly ? (
          <Link href="/onboarding" onClick={onNavigate} className="flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-[12px] text-muted hover:bg-hover hover:text-fg">
            <Icon name="plus" size={13} className="text-faint" />
            <span className="min-w-0 flex-1 truncate">Connect GitHub</span>
          </Link>
        ) : (
        <button
          type="button"
          onClick={() => void syncNow()}
          disabled={sync.busy}
          title={
            sync.error ??
            sync.notice ??
            (sync.needsInitialImport && !meta.demo
              ? "The first import from GitHub hasn't finished"
              : stale
                ? `Showing cached data from ${sync.lastSync ? new Date(sync.lastSync).toLocaleString([], { dateStyle: "short", timeStyle: "short" }) : "the last sync"}`
                : syncWarn
                ? syncWarningTitle(sync)
                : "Sync now")
          }
          data-sync-stale={stale ? "" : undefined}
          className="flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-[12px] text-muted hover:bg-hover"
        >
          <span
            aria-hidden
            className={`size-1.5 shrink-0 rounded-full ${
              sync.error ? "bg-critical" : sync.rateLimited || syncWarn || stale ? "bg-warning" : sync.lastSync || meta.demo ? "bg-brand-border" : "bg-faint"
            }`}
          />
          <span className="min-w-0 flex-1 truncate">
            {sync.busy
              ? "Syncing…"
              : sync.error
                ? "Sync failed"
                : sync.notice
                  ? sync.notice
                  : sync.rateLimited
                    ? "Rate limited"
                    : meta.demo
                      ? "Demo data"
                      : sync.needsInitialImport
                        ? "Importing…"
                        : stale
                          ? `Stale · synced ${longAgo(sync.lastSync)}`
                        : syncWarn === "failing"
                          ? "Sync failing"
                          : `Synced ${longAgo(sync.lastSync)}`}
          </span>
          <Icon name="refresh" size={13} className={`text-faint ${sync.busy ? "animate-spin" : ""}`} />
        </button>
        )}
        <div className="flex gap-1">
          <button type="button" onClick={() => window.dispatchEvent(new CustomEvent(HELP_EVENT))} title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts" data-help-button className="flex h-7 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-[12px] text-muted hover:bg-hover hover:text-fg">
            <Icon name="keyboard" size={14} className="text-faint" />
            <span className="truncate">Shortcuts</span>
          </button>
          <button type="button" onClick={() => setCustomize(true)} title="Customize sidebar" aria-label="Customize sidebar" className="flex h-7 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-[12px] text-muted hover:bg-hover hover:text-fg">
            <Icon name="sliders" size={14} className="text-faint" />
            <span className="truncate">Customize</span>
          </button>
        </div>
        <UserMenu />
      </div>
    </div>
  );
}
