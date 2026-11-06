"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { encodeState, primaryDimension, sprintOn } from "@/lib/client/explorer";
import { plainName } from "@/lib/client/format";
import { PRESETS } from "@/lib/client/presets";
import { newIssueUrl, searchPrs, searchTasks } from "@/lib/client/palette";
import { matchesCommand, searchIssues } from "@/lib/client/search";
import type { ClientIssue, ClientPr } from "@/lib/client/types";
import type { Task } from "@/lib/tasks/model";
import { useCells } from "../explorer/cells";
import { Icon, type IconName } from "../icons";
import { Kbd, OptionDot } from "../props";
import { openPr, PR_PARAM } from "../prs/open-pr";
import { usePrs } from "../prs/store";
import { openTask } from "../tasks/open-task";
import { useTasks } from "../tasks/store";
import { Dialog } from "../ui/dialog";
import { PEEK_PARAM, recentIssues, useOpenIssue } from "./open-issue";
import { useApp } from "./provider";
import { CUSTOMIZE_SIDEBAR_EVENT } from "./sidebar-customize";

type Item = {
  id: string;
  section: string;
  label: string;
  icon: ReactNode;
  hint?: ReactNode;
  keywords?: string;
  issue?: ClientIssue;
  pr?: ClientPr;
  task?: Task;
  run: (opts: { meta: boolean }) => void;
};

export const PALETTE_EVENT = "deska:palette";
export const HELP_EVENT = "deska:help";

function IssueLine({ issue }: { issue: ClientIssue }) {
  const c = useCells();
  return (
    <>
      {c.status(issue)}
      <span className="w-14 shrink-0">{c.id(issue)}</span>
      <span className={`min-w-0 flex-1 truncate ${issue.state === "closed" ? "text-muted" : ""}`}>{issue.title}</span>
      <span className="hidden shrink-0 items-center gap-1.5 sm:flex">
        {c.priority(issue)}
        {c.release(issue)}
      </span>
    </>
  );
}

function PrLine({ pr }: { pr: ClientPr }) {
  return (
    <>
      <Icon name="git" size={15} className={pr.state === "merged" ? "text-brand-text" : "text-faint"} />
      <span className="w-14 shrink-0 text-faint">#{pr.number}</span>
      <span className={`min-w-0 flex-1 truncate ${pr.state === "open" ? "" : "text-muted"}`}>{pr.title}</span>
      <span className="hidden shrink-0 text-[11.5px] text-faint sm:block">{pr.author}</span>
    </>
  );
}

function TaskLine({ task }: { task: Task }) {
  return (
    <>
      <Icon name="circleCheck" size={15} className="text-faint" />
      <span className={`min-w-0 flex-1 truncate ${task.completedAt ? "text-muted line-through" : ""}`}>{task.title}</span>
    </>
  );
}

export function CommandPalette() {
  const app = useApp();
  const { data, views, syncNow, setTheme, theme, byNumber } = app;
  const { openCompose, tasks } = useTasks();
  const { prs } = usePrs();
  const router = useRouter();
  const openIssue = useOpenIssue();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  // Unique per instance, so two palettes don't share option ids.
  const listboxId = useId();
  const [recent, setRecent] = useState<number[]>([]);
  // The issue or PR open in the side panel when the palette opened: it gets actions of its own.
  const [target, setTarget] = useState<{ kind: "issue" | "pr"; n: number } | null>(null);

  useEffect(() => {
    const show = () => {
      setQ("");
      setActive(0);
      setRecent(recentIssues());
      const sp = new URL(window.location.href).searchParams;
      const issue = Number(sp.get(PEEK_PARAM));
      const pr = Number(sp.get(PR_PARAM));
      setTarget(issue > 0 ? { kind: "issue", n: issue } : pr > 0 ? { kind: "pr", n: pr } : null);
      setOpen(true);
    };
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (open) setOpen(false);
        else show();
      }
    };
    window.addEventListener(PALETTE_EVENT, show);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener(PALETTE_EVENT, show);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const go = useCallback((href: string) => () => router.push(href), [router]);
  const ico = (name: IconName) => <Icon name={name} size={15} className="text-faint" />;

  const commands = useMemo<Item[]>(() => {
    const { meta } = data;
    const cur = meta.releases.find((r) => r.id === meta.currentReleaseId);
    const next = meta.releases.find((r) => r.id === meta.nextReleaseId);
    const nav: Item[] = [
      { id: "nav:triage", section: "Go to", label: "Triage", keywords: "inbox untriaged", icon: ico("inbox"), hint: <Kbd>G T</Kbd>, run: go("/triage") },
      { id: "nav:watching", section: "Go to", label: "Watching", keywords: "starred follow changes watchlist", icon: ico("star"), run: go("/watching") },
      { id: "nav:my", section: "Go to", label: "My issues", icon: ico("user"), hint: <Kbd>G M</Kbd>, run: go("/my") },
      { id: "nav:tasks", section: "Go to", label: "Tasks inbox", keywords: "todo to-do my tasks", icon: ico("inbox"), hint: <Kbd>G D</Kbd>, run: go("/tasks") },
      { id: "nav:today", section: "Go to", label: "Tasks due today", keywords: "todo today overdue", icon: ico("star"), run: go("/tasks/today") },
      { id: "nav:upcoming", section: "Go to", label: "Upcoming tasks", keywords: "todo week schedule", icon: ico("calendar"), run: go("/tasks/upcoming") },
      { id: "nav:delegated", section: "Go to", label: "Delegated tasks", keywords: "todo assigned others", icon: ico("users"), run: go("/tasks/delegated") },
      { id: "nav:prreview", section: "Go to", label: "PRs waiting on my review", keywords: "pull requests review queue", icon: ico("eye"), hint: <Kbd>G P</Kbd>, run: go("/pulls/review") },
      { id: "nav:prmine", section: "Go to", label: "My open PRs", keywords: "pull requests mine authored", icon: ico("git"), run: go("/pulls/mine") },
      { id: "nav:prs", section: "Go to", label: "All pull requests", keywords: "pr explorer", icon: ico("git"), run: go("/pulls") },
      { id: "nav:all", section: "Go to", label: "All issues", icon: ico("layers"), hint: <Kbd>G I</Kbd>, run: go("/issues") },
      { id: "nav:backlog", section: "Go to", label: "Backlog", icon: ico("list"), hint: <Kbd>G B</Kbd>, run: go("/backlog") },
      ...(cur ? [{ id: "nav:cur", section: "Go to", label: `Current release · ${cur.title}`, keywords: "board sprint", icon: ico("calendar"), hint: <Kbd>G R</Kbd>, run: go(`/releases/${cur.id}`) }] : []),
      ...(next ? [{ id: "nav:next", section: "Go to", label: `Next release · ${next.title}`, keywords: "upcoming", icon: ico("calendar"), run: go(`/releases/${next.id}`) }] : []),
      { id: "nav:plan", section: "Go to", label: "Release planning", keywords: "plan carry-over load capacity next release", icon: ico("rocket"), run: go("/releases/plan") },
      { id: "nav:releases", section: "Go to", label: "Releases", keywords: "overview iterations sprints", icon: ico("rocket"), run: go("/releases") },
      { id: "nav:epics", section: "Go to", label: "Epics", keywords: "parent sub-issues", icon: ico("epic"), hint: <Kbd>G E</Kbd>, run: go("/epics") },
      { id: "nav:insights", section: "Go to", label: "Insights", keywords: "stats health dashboard charts", icon: ico("chart"), run: go("/insights") },
      { id: "nav:stale", section: "Go to", label: "Stale issues", keywords: "triage old", icon: ico("clock"), run: go("/triage?tab=stale") },
      { id: "nav:views", section: "Go to", label: "All views", icon: ico("eye"), hint: <Kbd>G V</Kbd>, run: go("/views") },
      { id: "nav:newview", section: "Go to", label: "New view", keywords: "create filter", icon: ico("plus"), run: go("/views/new") },
    ];
    const viewItems: Item[] = views.map((v) => ({
      id: `view:${v.id}`,
      section: "Views",
      label: v.name,
      keywords: "view",
      icon: ico(v.layout === "board" ? "board" : v.layout === "table" ? "table" : "list"),
      run: go(`/views/${v.id}`),
    }));
    const dim = primaryDimension(meta);
    const teams: Item[] = (dim?.options ?? []).map((t) => ({
      id: `dim:${t.id}`,
      section: dim!.name,
      label: plainName(t.name) || t.name,
      keywords: dim!.name.toLowerCase(),
      icon: <OptionDot color={t.color} />,
      run: go(`/teams/${t.id}`),
    }));
    const releases: Item[] = [...meta.releases].reverse().map((r) => ({
      id: `rel:${r.id}`,
      section: "Releases",
      label: `Release ${r.title}`,
      keywords: "release iteration sprint",
      icon: ico("calendar"),
      hint: r.id === meta.currentReleaseId ? <span className="text-[11px] text-brand-text">current</span> : undefined,
      run: go(`/releases/${r.id}`),
    }));
    const actions: Item[] = [
      { id: "act:sync", section: "Actions", label: "Sync now", keywords: "refresh github update", icon: ico("refresh"), run: () => void syncNow() },
      {
        id: "act:theme",
        section: "Actions",
        label: theme === "dark" ? "Switch to light theme" : "Switch to dark theme",
        keywords: "theme appearance mode dark light",
        icon: ico(theme === "dark" ? "sun" : "moon"),
        run: () => setTheme(theme === "dark" ? "light" : "dark"),
      },
      { id: "act:system", section: "Actions", label: "Use system theme", keywords: "theme appearance auto", icon: ico("monitor"), run: () => setTheme("system") },
      { id: "act:sidebar", section: "Actions", label: "Customize sidebar", keywords: "hide show reorder sections navigation", icon: ico("sliders"), run: () => window.dispatchEvent(new CustomEvent(CUSTOMIZE_SIDEBAR_EVENT)) },
      {
        id: "act:copy",
        section: "Actions",
        label: "Copy link to this page",
        keywords: "share url",
        icon: ico("link"),
        run: () => void navigator.clipboard?.writeText(window.location.href),
      },
      { id: "act:task", section: "Actions", label: "Add task", keywords: "new todo to-do create quick", icon: ico("plus"), hint: <Kbd>Q</Kbd>, run: () => openCompose() },
      { id: "act:help", section: "Actions", label: "Keyboard shortcuts", keywords: "help keys hotkeys", icon: ico("keyboard"), hint: <Kbd>?</Kbd>, run: () => window.dispatchEvent(new CustomEvent(HELP_EVENT)) },
      { id: "act:newissue", section: "Actions", label: "Create issue on GitHub", keywords: "new issue file report bug", icon: ico("plus"), run: () => window.open(newIssueUrl(meta.repo), "_blank", "noopener") },
      {
        id: "act:github",
        section: "Actions",
        label: "Open repository on GitHub",
        keywords: "github repo issues",
        icon: ico("external"),
        run: () => window.open(`https://github.com/${meta.repo}/issues`, "_blank", "noopener"),
      },
    ];
    // Sprint features show only with a mapped Sprint field (§4.1).
    const sprints = sprintOn(meta);
    const sprintNav = new Set(["nav:backlog", "nav:cur", "nav:next", "nav:plan", "nav:releases"]);
    return [...nav.filter((n) => sprints || !sprintNav.has(n.id)), ...viewItems, ...actions, ...teams, ...(sprints ? releases : [])];
  }, [data, views, theme, openCompose, go, setTheme, syncNow]);

  const targetActions = useMemo<Item[]>(() => {
    if (!target) return [];
    const issue = target.kind === "issue" ? byNumber.get(target.n) : undefined;
    const pr = target.kind === "pr" ? prs.find((p) => p.number === target.n) : undefined;
    const url = issue?.url ?? pr?.url;
    if (!url) return [];
    const section = target.kind === "issue" ? "This issue" : "This pull request";
    return [
      { id: "tgt:task", section, label: `Add #${target.n} to tasks`, keywords: "task todo", icon: ico("plus"), run: () => openCompose({ links: [target.n] }) },
      { id: "tgt:copy", section, label: `Copy link to #${target.n}`, keywords: "share url", icon: ico("link"), run: () => void navigator.clipboard?.writeText(url) },
      { id: "tgt:gh", section, label: `Open #${target.n} on GitHub`, keywords: "external", icon: ico("external"), run: () => { if (!data.meta.demo) window.open(url, "_blank", "noopener"); } },
    ];
  }, [target, byNumber, prs, openCompose, data.meta.demo]);

  const items = useMemo<Item[]>(() => {
    const query = q.trim();
    const issueItem = (i: ClientIssue, section: string): Item => ({
      id: `issue:${i.nodeId}`,
      section,
      label: i.title,
      icon: null,
      issue: i,
      run: ({ meta }) => {
        if (meta) {
          if (!data.meta.demo) window.open(i.url, "_blank", "noopener");
          return;
        }
        openIssue(i.number);
      },
    });
    if (!query) {
      const rec = recent
        .map((n) => byNumber.get(n))
        .filter((i): i is ClientIssue => !!i)
        .slice(0, 5)
        .map((i) => issueItem(i, "Recent issues"));
      return [...targetActions, ...rec, ...commands.filter((c) => c.section === "Go to" || c.section === "Actions")];
    }
    const issues = searchIssues(data.issues, query, 8).map((i) => issueItem(i, "Issues"));
    const prItems: Item[] = searchPrs(prs, query, 5).map((p) => ({
      id: `pr:${p.nodeId}`,
      section: "Pull requests",
      label: p.title,
      icon: null,
      pr: p,
      run: ({ meta }) => {
        if (meta) {
          if (!data.meta.demo) window.open(p.url, "_blank", "noopener");
          return;
        }
        openPr(p.number);
      },
    }));
    const taskItems: Item[] = searchTasks(tasks, query, app.viewer, 5).map((t) => ({
      id: `task:${t.id}`,
      section: "Tasks",
      label: t.title,
      icon: null,
      task: t,
      run: () => openTask(t.id),
    }));
    const cmds = commands.filter((c) => matchesCommand(c.label, c.keywords ?? "", query)).slice(0, 10);
    const searchAll: Item = {
      id: "search-all",
      section: "Issues",
      label: `Search all issues for “${query}”`,
      icon: ico("search"),
      run: () =>
        router.push(`/issues?s=${encodeState({ ...PRESETS.all, filters: [{ field: "text", op: "contains", value: query }] })}`),
    };
    // A bare number most likely means "go to issue"; otherwise commands first.
    const isNumber = /^#?\d+$/.test(query);
    // The same number can be an issue and a PR: issues first, then PRs.
    return isNumber ? [...issues, ...prItems, ...cmds, ...taskItems, searchAll] : [...cmds, ...issues, ...prItems, ...taskItems, searchAll];
    // openIssue and router are used above: without them the memo keeps a stale
    // openIssue after a client-side navigation.
  }, [q, commands, data.issues, data.meta.demo, recent, byNumber, prs, tasks, app.viewer, targetActions, openIssue, router]);

  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const run = (it: Item | undefined, meta = false) => {
    if (!it) return;
    setOpen(false);
    it.run({ meta });
  };

  return (
    <Dialog open={open} onClose={() => setOpen(false)} label="Command palette" width={640}>
      <div className="flex items-center gap-2.5 border-b border-line px-4">
        <Icon name="search" size={16} className="text-faint" />
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || (e.ctrlKey && e.key === "n")) {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, items.length - 1));
            } else if (e.key === "ArrowUp" || (e.ctrlKey && e.key === "p")) {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              run(items[active], e.metaKey || e.ctrlKey);
            }
          }}
          role="combobox"
          aria-expanded
          aria-controls={listboxId}
          aria-activedescendant={items[active] ? `${listboxId}-${active}` : undefined}
          placeholder="Search issues by title or #number, jump to a page, run a command…"
          aria-label="Search commands and issues"
          className="h-12 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-faint"
        />
        <Kbd>esc</Kbd>
      </div>
      <div id={listboxId} ref={listRef} role="listbox" aria-label="Results" className="max-h-[min(60vh,460px)] overflow-y-auto p-1.5">
        {items.length === 0 && <p className="px-3 py-6 text-center text-faint">No results</p>}
        {items.map((it, idx) => {
          const showSection = it.section !== items[idx - 1]?.section;
          return (
            <div key={it.id}>
              {showSection && <p className="px-2.5 pb-1 pt-2.5 text-[11px] font-semibold text-faint">{it.section}</p>}
              <button
                type="button"
                role="option"
                id={`${listboxId}-${idx}`}
                aria-selected={idx === active}
                data-idx={idx}
                onMouseMove={() => setActive(idx)}
                onClick={(e) => run(it, e.metaKey || e.ctrlKey)}
                className={`flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[13.5px] ${idx === active ? "bg-hover" : ""}`}
              >
                {it.issue ? (
                  <IssueLine issue={it.issue} />
                ) : it.pr ? (
                  <PrLine pr={it.pr} />
                ) : it.task ? (
                  <TaskLine task={it.task} />
                ) : (
                  <>
                    <span className="grid w-4 place-items-center">{it.icon}</span>
                    <span className="min-w-0 flex-1 truncate">{it.label}</span>
                    {it.hint}
                  </>
                )}
              </button>
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-3 border-t border-line px-3 py-2 text-[11.5px] text-faint">
        <span className="flex items-center gap-1">
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd> navigate
        </span>
        <span className="flex items-center gap-1">
          <Kbd>↵</Kbd> open
        </span>
        <span className="flex items-center gap-1">
          <Kbd>⌘</Kbd>
          <Kbd>↵</Kbd> open in GitHub
        </span>
      </div>
    </Dialog>
  );
}
