"use client";

import Link from "next/link";
import { HELP_EVENT } from "./palette";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { longAgo, plainName } from "@/lib/client/format";
import { syncWarning, syncWarningTitle } from "@/lib/client/sync-health";
import { Icon, Logo, type IconName } from "../icons";
import { Kbd, OptionDot } from "../props";
import { useTriageCount } from "../triage/queues";
import { useTasks } from "../tasks/store";
import { useTaskDrop } from "../tasks/drop";
import type { DropTarget } from "@/lib/client/task-drop";
import { useWatchlist } from "../watch/store";
import { useDefaultScope } from "./team-scope";
import { primaryDimension, sprintOn } from "@/lib/client/explorer";
import { UserMenu } from "./user-menu";
import { type SidebarSection } from "@/lib/tasks/model";
import { ColorDot, ProjectDialog } from "../tasks/organize";
import { dueCount } from "@/lib/tasks/counts";
import { NotificationBell, useToday } from "../tasks/notifications";
import { PALETTE_EVENT } from "./palette";
import { openCreateIssue } from "../issue/create-issue";
import { useAppData, useAppSync, useAppViews } from "./provider";
import { useConnection } from "./connection";
import { useTasksOnly } from "./tasks-only";
import { CUSTOMIZE_SIDEBAR_EVENT, CustomizeSidebarDialog, useSidebarLayout } from "./sidebar-customize";

type NavItem = { href: string; label: string; icon: IconName; count?: number; match?: (p: string) => boolean; drop?: DropTarget };

export function openPalette() {
  window.dispatchEvent(new CustomEvent(PALETTE_EVENT));
}

function NavLink({ item, onNavigate }: { item: NavItem; onNavigate?: () => void }) {
  const path = usePathname();
  const active = item.match ? item.match(path) : path === item.href || path.startsWith(`${item.href}/`);
  const drop = useTaskDrop(item.drop ?? { kind: "inbox" });
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      {...(item.drop ? drop.handlers : {})}
      data-drop-target={item.drop?.kind}
      className={`group flex h-7 items-center gap-2 rounded-md px-2 text-[13px] font-medium transition-colors ${
        active ? "bg-active text-fg" : "text-muted hover:bg-hover hover:text-fg"
      } ${item.drop && drop.over ? "ring-2 ring-brand-border bg-brand-soft" : ""}`}
    >
      <Icon name={item.icon} size={15} className={active ? "text-fg" : "text-faint group-hover:text-muted"} />
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {item.count != null && item.count > 0 && <span className="text-[11px] tabular-nums text-faint">{item.count.toLocaleString()}</span>}
    </Link>
  );
}

function ProjectLink({
  href,
  label,
  color,
  count,
  shape = "circle",
  onNavigate,
  drop: target,
}: {
  href: string;
  label: string;
  color: string;
  count?: number;
  shape?: "circle" | "tag";
  onNavigate?: () => void;
  /** Dropping a task here files it (a project) or labels it (a label). */
  drop?: DropTarget;
}) {
  const path = usePathname();
  const active = path === href;
  const drop = useTaskDrop(target ?? { kind: "inbox" });
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      {...(target ? drop.handlers : {})}
      data-drop-target={target?.kind}
      className={`flex h-7 items-center gap-2 rounded-md px-2 text-[13px] font-medium ${active ? "bg-active text-fg" : "text-muted hover:bg-hover hover:text-fg"} ${target && drop.over ? "ring-2 ring-brand-border bg-brand-soft" : ""}`}
    >
      <span className="grid size-[15px] place-items-center">
        <ColorDot color={color} size={8} shape={shape} />
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count != null && count > 0 && <span className="text-[11px] tabular-nums text-faint">{count}</span>}
    </Link>
  );
}

function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="mt-4">
      <div className="group flex h-6 items-center px-2">
        <button type="button" onClick={() => setOpen((o) => !o)} className="flex flex-1 items-center gap-1 text-[11.5px] font-semibold text-faint hover:text-muted">
          {title}
          <Icon name={open ? "chevronDown" : "chevronRight"} size={12} className="opacity-0 group-hover:opacity-100" />
        </button>
        {action}
      </div>
      {open && <div className="mt-0.5 space-y-px">{children}</div>}
    </div>
  );
}


/** Sidebar blocks that need GitHub data; hidden in "tasks only" mode. */
const GITHUB_SECTIONS: SidebarSection[] = ["workspace", "views", "teams"];

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const tasksOnly = useTasksOnly();
  const { data, viewer } = useAppData();
  const { views } = useAppViews();
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
  const { sections } = useSidebarLayout();
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
  const taskCounts = useMemo(() => {
    const archived = new Set(projects.filter((p) => p.archived).map((p) => p.id));
    let inbox = 0;
    const perProject = new Map<string, number>();
    for (const t of tasks) {
      if (t.completedAt || (t.projectId && archived.has(t.projectId))) continue;
      if (t.projectId) perProject.set(t.projectId, (perProject.get(t.projectId) ?? 0) + 1);
      if (!t.parentId) inbox++;
    }
    const due = dueCount(tasks, projects, today);
    return { inbox, due, perProject };
  }, [tasks, projects, today]);
  const taskNav: NavItem[] = [
    { href: "/tasks", label: "Inbox", icon: "inbox", count: taskCounts.inbox, match: (p) => p === "/tasks", drop: { kind: "inbox" } },
    { href: "/tasks/today", label: "Today", icon: "star", count: taskCounts.due, drop: { kind: "today" } },
    { href: "/tasks/upcoming", label: "Upcoming", icon: "calendar", drop: { kind: "upcoming" } },
    { href: "/tasks/completed", label: "Completed", icon: "circleCheck" },
  ];

  const current = meta.releases.find((r) => r.id === meta.currentReleaseId);
  const triage = useTriageCount();
  const { unseen: watchUnseen } = useWatchlist();
  const primary: NavItem[] = [
    { href: "/triage", label: "Triage", icon: "inbox", count: triage },
    { href: "/my", label: "My issues", icon: "user", count: counts.mine },
    { href: "/watching", label: "Watching", icon: "star", count: watchUnseen },
  ];
  const workspace: NavItem[] = [
    { href: "/issues", label: "All issues", icon: "layers", match: (p) => p === "/issues" },
    // Sprint features show only with a mapped Sprint field (§4.1).
    ...(sprints
      ? [
          { href: "/backlog", label: "Backlog", icon: "list" as IconName, count: counts.backlog },
          { href: "/releases", label: "Releases", icon: "rocket" as IconName, match: (p: string) => p === "/releases" },
          ...(current ? [{ href: `/releases/${current.id}`, label: `Current · ${current.title}`, icon: "calendar" as IconName }] : []),
        ]
      : []),
    { href: "/epics", label: "Epics", icon: "epic" },
    { href: "/insights", label: "Insights", icon: "chart" },
  ];

  const blocks: Record<SidebarSection, React.ReactNode> = {
    tasks: (
      <Section
        key="tasks"
        title="Tasks"
        action={
          <button type="button" onClick={() => openCompose()} title="New task" aria-label="New task" className="grid size-5 place-items-center rounded text-faint hover:bg-hover hover:text-fg">
            <Icon name="plus" size={13} />
          </button>
        }
      >
        {taskNav.map((n) => (
          <NavLink key={n.href} item={n} onNavigate={onNavigate} />
        ))}
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
        {projects
          .filter((p) => !p.archived)
          .map((p) => (
            <ProjectLink key={p.id} href={`/tasks/p/${p.id}`} label={p.name} color={p.color} count={taskCounts.perProject.get(p.id)} onNavigate={onNavigate} drop={{ kind: "project", id: p.id, name: p.name }} />
          ))}
        {projects.every((p) => p.archived) && <p className="px-2 py-1 text-[12px] text-faint">No projects yet</p>}
        {projects.some((p) => p.archived) && (
          <details className="px-2 text-[12px] text-faint">
            <summary className="cursor-pointer py-1 hover:text-muted">Archived</summary>
            {projects
              .filter((p) => p.archived)
              .map((p) => (
                <ProjectLink key={p.id} href={`/tasks/p/${p.id}`} label={p.name} color={p.color} onNavigate={onNavigate} />
              ))}
          </details>
        )}
      </Section>
    ),
    labels:
      labels.length > 0 ? (
      <Section key="labels" title="Labels">
        {labels.map((l) => (
          <ProjectLink key={l.id} href={`/tasks/l/${l.id}`} label={l.name} color={l.color} shape="tag" onNavigate={onNavigate} drop={{ kind: "label", name: l.name }} />
        ))}
      </Section>
      ) : null,
    workspace: (
      <Section key="workspace" title="Workspace">
        {workspace.map((n) => (
          <NavLink key={n.href} item={n} onNavigate={onNavigate} />
        ))}
      </Section>
    ),
    views: (
      <Section
        key="views"
        title="Views"
        action={
          <Link href="/views/new" onClick={onNavigate} title="New view" className="grid size-5 place-items-center rounded text-faint hover:bg-hover hover:text-fg">
            <Icon name="plus" size={13} />
          </Link>
        }
      >
        {views.map((v) => (
          <NavLink
            key={v.id}
            onNavigate={onNavigate}
            item={{
              href: `/views/${v.id}`,
              label: v.name,
              icon: v.layout === "board" ? "board" : v.layout === "table" ? "table" : "list",
            }}
          />
        ))}
        {views.length === 0 && <p className="px-2 py-1 text-[12px] text-faint">No views yet</p>}
      </Section>
    ),
    teams: (
      <Section key="teams" title={dim?.name ?? "Dimensions"}>
        {!dim && <p className="px-2 py-1 text-[12px] text-faint">No dimension mapped</p>}
        {(dim?.options ?? []).map((t) => (
          <Link
            key={t.id}
            href={`/teams/${t.id}`}
            onClick={onNavigate}
            className="flex h-7 items-center gap-2 rounded-md px-2 text-[13px] font-medium text-muted hover:bg-hover hover:text-fg"
          >
            <span className="grid size-[15px] place-items-center">
              <OptionDot color={t.color} size={8} />
            </span>
            <span className="truncate">{plainName(t.name) || t.name}</span>
          </Link>
        ))}
      </Section>
    ),
  };

  return (
    <div className="flex h-full flex-col px-2.5 pb-2.5 pt-3">
      <div className="flex items-center gap-2 px-1.5">
        <Logo size={22} />
        <div className="min-w-0 flex-1 leading-tight">
          <p className="text-[13.5px] font-semibold tracking-tight">Deska</p>
          <p className="truncate text-[11px] text-faint">{tasksOnly ? "Tasks" : meta.repo}</p>
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

      <nav aria-label="Main" className="mt-3 min-h-0 flex-1 overflow-y-auto pr-0.5">
        <div className="space-y-px">
          {!tasksOnly && primary.map((n) => (
            <NavLink key={n.href} item={n} onNavigate={onNavigate} />
          ))}
        </div>

        {sections.filter((x) => !x.hidden && !(tasksOnly && GITHUB_SECTIONS.includes(x.id))).map((x) => blocks[x.id])}
        <ProjectDialog open={newProject} onClose={() => setNewProject(false)} />
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
