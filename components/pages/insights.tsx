"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import { encodeState, type ExplorerState } from "@/lib/client/explorer";
import { insightStats, parseScope, parseWaitDays, prsForIssues, scopeFilters, scopeParam, scopedIssues, waitingForReview, WAIT_DAYS, type Scope } from "@/lib/client/insights";
import { DEFAULT_PR_STATE } from "@/lib/client/prs";
import { longAgo, plainName } from "@/lib/client/format";
import { OPEN } from "@/lib/client/presets";
import type { ClientIssue } from "@/lib/client/types";
import type { Filter } from "@/lib/views/view";
import { useAppData, useAppViews } from "../app/provider";
import { useTeamScope } from "../app/team-scope";
import { Page } from "../app/shell";
import { Icon } from "../icons";
import { Avatar, OptionDot, PriorityIcon } from "../props";
import { usePrs } from "../prs/store";
import { TRIAGE_TABS } from "../triage/queues";

const DAY = 86_400_000;

/** Link to All issues with these filters applied. */
function issuesHref(filters: Filter[], extra: Partial<ExplorerState> = {}): string {
  return `/issues?s=${encodeState({ filters, sort: [{ field: "priority", dir: "desc" }, { field: "updated", dir: "desc" }], layout: "list", ...extra })}`;
}

function Tile({ label, value, sub, href, tone }: { label: string; value: number; sub?: ReactNode; href: string; tone?: "warning" | "critical" }) {
  return (
    <Link href={href} className="group rounded-xl border border-line bg-surface p-4 shadow-raised transition-colors hover:border-line-field">
      <p className="flex items-center justify-between text-[12.5px] text-muted">
        {label}
        <Icon name="chevronRight" size={13} className="text-faint opacity-0 transition-opacity group-hover:opacity-100" />
      </p>
      <p className={`mt-2 text-[28px] font-medium leading-none tracking-tight tabular-nums ${tone === "critical" ? "text-critical" : tone === "warning" ? "text-warning" : ""}`}>
        {value.toLocaleString()}
      </p>
      {sub && <p className="mt-1.5 text-[12px] text-faint">{sub}</p>}
    </Link>
  );
}

type Bar = { key: string; label: string; icon?: ReactNode; n: number; href: string };

/** Single-series horizontal bars: one hue for magnitude, identity carried by the icon. */
function BarList({ title, bars, total, note }: { title: string; bars: Bar[]; total: number; note?: string }) {
  const max = Math.max(1, ...bars.map((b) => b.n));
  return (
    <section className="rounded-xl border border-line bg-surface p-4 shadow-raised">
      <h2 className="text-[13px] font-semibold">{title}</h2>
      {note && <p className="mt-0.5 text-[11.5px] text-faint">{note}</p>}
      <ul className="mt-3 space-y-1">
        {bars.map((b) => (
          <li key={b.key}>
            <Link href={b.href} className="group grid grid-cols-[minmax(0,9.5rem)_1fr_2.75rem] items-center gap-2.5 rounded-md px-1 py-1 hover:bg-hover" title={`${b.label}: ${b.n} (${Math.round((b.n / Math.max(1, total)) * 100)}%)`}>
              <span className="flex min-w-0 items-center gap-1.5 text-[12.5px] text-muted group-hover:text-fg">
                {b.icon}
                <span className="truncate">{b.label}</span>
              </span>
              <span className="h-3.5">
                <span className="block h-full rounded-r-[4px] bg-series-1 transition-opacity group-hover:opacity-80" style={{ width: `${(b.n / max) * 100}%`, minWidth: b.n ? 3 : 0 }} />
              </span>
              <span className="text-right text-[12px] tabular-nums text-muted">{b.n.toLocaleString()}</span>
            </Link>
          </li>
        ))}
        {bars.length === 0 && <li className="py-3 text-center text-[12px] text-faint">No data</li>}
      </ul>
    </section>
  );
}

function weekStart(t: number): number {
  const d = new Date(t);
  const day = (d.getUTCDay() + 6) % 7; // Monday
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day);
}

/** Created vs closed per week: two series, legend + hover tooltip, one axis. */
function FlowChart({ issues, today }: { issues: ClientIssue[]; today: string }) {
  const WEEKS = 12;
  const weeks = useMemo(() => {
    const end = weekStart(Date.parse(`${today}T12:00:00Z`));
    const list = Array.from({ length: WEEKS }, (_, k) => ({ start: end - (WEEKS - 1 - k) * 7 * DAY, created: 0, closed: 0 }));
    const idx = (iso: string) => {
      const w = weekStart(Date.parse(iso));
      return Math.round((w - list[0]!.start) / (7 * DAY));
    };
    for (const i of issues) {
      const c = idx(i.createdAt);
      if (c >= 0 && c < WEEKS) list[c]!.created++;
      if (i.closedAt) {
        const k = idx(i.closedAt);
        if (k >= 0 && k < WEEKS) list[k]!.closed++;
      }
    }
    return list;
  }, [issues, today]);
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...weeks.flatMap((w) => [w.created, w.closed]));
  const nice = Math.ceil(max / 5) * 5;
  const H = 160;
  const label = (t: number) => new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  const totals = weeks.reduce((a, w) => ({ created: a.created + w.created, closed: a.closed + w.closed }), { created: 0, closed: 0 });

  return (
    <section className="rounded-xl border border-line bg-surface p-4 shadow-raised lg:col-span-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-[13px] font-semibold">Opened vs closed per week</h2>
          <p className="mt-0.5 text-[11.5px] text-faint">Last {WEEKS} weeks · closed issues are synced for the import window only</p>
        </div>
        <div className="flex items-center gap-4 text-[12px] text-muted" aria-label="Legend">
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-[3px] bg-series-1" /> Opened <span className="tabular-nums text-faint">{totals.created}</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-[3px] bg-series-2" /> Closed <span className="tabular-nums text-faint">{totals.closed}</span>
          </span>
        </div>
      </div>
      <div className="relative mt-4" onMouseLeave={() => setHover(null)}>
        <div className="pointer-events-none absolute inset-x-0 top-0" style={{ height: H }}>
          {[0, 0.5, 1].map((f) => (
            <div key={f} className="absolute inset-x-0 border-t border-line-soft" style={{ top: H - f * H }}>
              <span className="absolute -top-2 right-full mr-1 text-[10.5px] tabular-nums text-faint">{Math.round(nice * f)}</span>
            </div>
          ))}
        </div>
        <div className="ml-6 grid items-end gap-1" style={{ gridTemplateColumns: `repeat(${WEEKS}, minmax(0, 1fr))`, height: H }}>
          {weeks.map((w, k) => (
            <div key={w.start} className="relative flex h-full items-end justify-center gap-[2px] rounded-md px-0.5" onMouseEnter={() => setHover(k)} style={{ background: hover === k ? "var(--hover)" : undefined }}>
              <span className="w-full max-w-3.5 rounded-t-[4px] bg-series-1" style={{ height: (w.created / nice) * H }} />
              <span className="w-full max-w-3.5 rounded-t-[4px] bg-series-2" style={{ height: (w.closed / nice) * H }} />
              {hover === k && (
                <div role="tooltip" className="anim-pop absolute bottom-full z-10 mb-2 w-36 rounded-lg border border-line bg-popover p-2 text-[12px] shadow-pop" style={{ left: k > WEEKS - 3 ? "auto" : "50%", right: k > WEEKS - 3 ? 0 : "auto", transform: k > WEEKS - 3 ? undefined : "translateX(-50%)" }}>
                  <p className="font-semibold">Week of {label(w.start)}</p>
                  <p className="mt-1 flex justify-between text-muted">
                    <span className="flex items-center gap-1.5">
                      <span className="size-2 rounded-sm bg-series-1" />
                      Opened
                    </span>
                    <span className="tabular-nums text-fg">{w.created}</span>
                  </p>
                  <p className="flex justify-between text-muted">
                    <span className="flex items-center gap-1.5">
                      <span className="size-2 rounded-sm bg-series-2" />
                      Closed
                    </span>
                    <span className="tabular-nums text-fg">{w.closed}</span>
                  </p>
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="ml-6 mt-1.5 grid gap-1 text-center text-[10.5px] text-faint" style={{ gridTemplateColumns: `repeat(${WEEKS}, minmax(0, 1fr))` }}>
          {weeks.map((w, k) => (
            <span key={w.start} className={k % 2 ? "hidden sm:block" : ""}>
              {label(w.start)}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

/** Whole repo, a Team, a Release or a saved view; the URL (`?scope=`) keeps it. */
function ScopePicker({ scope, onChange }: { scope: Scope; onChange: (s: Scope) => void }) {
  const { data } = useAppData();
  const { views } = useAppViews();
  const { meta } = data;
  const value = scopeParam(scope) ?? "";
  return (
    <label className="flex items-center gap-2 text-[12.5px] text-muted">
      Scope
      <select
        aria-label="Scope"
        value={value}
        onChange={(e) => onChange(parseScope(e.target.value))}
        className="h-7 max-w-[14rem] rounded-md border border-line bg-field px-2 text-[12.5px] text-fg outline-none hover:border-line-field"
      >
        <option value="">Whole repo</option>
        <optgroup label="Team">
          {meta.fields.team.map((t) => (
            <option key={t.id} value={`team:${t.id}`}>
              {plainName(t.name) || t.name}
            </option>
          ))}
        </optgroup>
        <optgroup label="Release">
          {[...meta.releases].reverse().map((r) => (
            <option key={r.id} value={`release:${r.id}`}>
              Release {r.title}
            </option>
          ))}
        </optgroup>
        <optgroup label="Saved view">
          {views
            .filter((v) => v.entity !== "pr")
            .map((v) => (
              <option key={v.id} value={`view:${v.id}`}>
                {v.name}
              </option>
            ))}
        </optgroup>
      </select>
    </label>
  );
}

/** Open PRs waiting for review longer than N days, by who is asked. */
function ReviewWait({ issues, scope, days, onDays }: { issues: ClientIssue[]; scope: Scope; days: number; onDays: (n: number) => void }) {
  const { prs, loaded } = usePrs();
  const { data } = useAppData();
  const now = Date.parse(`${data.meta.today}T23:59:59Z`);
  const groups = useMemo(() => waitingForReview(scope.kind === "all" ? prs : prsForIssues(prs, issues), days, now), [prs, issues, scope.kind, days, now]);
  const total = new Set(groups.flatMap((g) => g.prs.map((p) => p.nodeId))).size;
  const max = Math.max(1, ...groups.map((g) => g.prs.length));
  const href = (reviewer: string, kind: "user" | "team") =>
    `/pulls?s=${encodeState({ ...DEFAULT_PR_STATE, filters: [{ field: "state", values: ["open"] }, { field: "requested", values: [kind === "team" ? `team:${reviewer}` : reviewer] }] } as never)}`;
  return (
    <section className="rounded-xl border border-line bg-surface p-4 shadow-raised lg:col-span-2" data-review-wait>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-[13px] font-semibold">
            Pull requests waiting for review <span className="font-normal text-faint tabular-nums" data-review-wait-total>{loaded ? total : "…"}</span>
          </h2>
          <p className="mt-0.5 text-[11.5px] text-faint">
            Open, ready PRs with a pending review request, waiting more than {days} days since they were opened or last reviewed
            {scope.kind === "all" ? "" : " · only PRs that close issues in this scope"}
          </p>
        </div>
        <div role="group" aria-label="Waiting longer than" className="flex items-center gap-1 rounded-lg bg-hover p-1 text-[12px]">
          {WAIT_DAYS.map((n) => (
            <button key={n} type="button" aria-pressed={days === n} onClick={() => onDays(n)} className={`h-6 rounded-md px-2 font-medium ${days === n ? "bg-surface text-fg shadow-raised" : "text-muted hover:text-fg"}`}>
              {n} days
            </button>
          ))}
        </div>
      </div>
      <ul className="mt-3 space-y-1">
        {groups.map((g) => (
          <li key={g.key} data-reviewer={g.key}>
            <Link href={href(g.label.replace(/^team\//, ""), g.kind)} className="group grid grid-cols-[minmax(0,10rem)_1fr_2.75rem] items-center gap-2.5 rounded-md px-1 py-1 hover:bg-hover" title={`${g.label}: oldest ${longAgo(g.prs[0]!.createdAt)}`}>
              <span className="truncate text-[12.5px] text-muted group-hover:text-fg">{g.label}</span>
              <span className="h-3.5">
                <span className="block h-full rounded-r-[4px] bg-series-1" style={{ width: `${(g.prs.length / max) * 100}%`, minWidth: 3 }} />
              </span>
              <span className="text-right text-[12px] tabular-nums text-muted">{g.prs.length}</span>
            </Link>
          </li>
        ))}
        {loaded && groups.length === 0 && <li className="py-3 text-center text-[12px] text-faint">Nobody is waiting longer than {days} days.</li>}
      </ul>
    </section>
  );
}

export function InsightsPage() {
  const { data, avatarOf } = useAppData();
  const { views } = useAppViews();
  const { meta, issues } = data;
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  // No scope in the URL: the viewer's default Team, if they set one (the user menu).
  const { teamId: defaultTeam } = useTeamScope();
  const scope = useMemo<Scope>(() => (params.has("scope") ? parseScope(params.get("scope")) : defaultTeam ? { kind: "team", id: defaultTeam } : parseScope(null)), [params, defaultTeam]);
  const days = parseWaitDays(params.get("days"));
  const missingView = scope.kind === "view" && scopeFilters(scope, views) === null;
  const scoped = useMemo(() => scopedIssues(issues, scope, views, meta), [issues, scope, views, meta]);
  // Links keep the scope's filters, so a number opens exactly the issues it counts.
  const scopeF = useMemo(() => scopeFilters(scope, views) ?? [], [scope, views]);
  const href = (filters: Filter[], extra: Partial<ExplorerState> = {}) => issuesHref([...scopeF, ...filters], extra);
  const setParam = (key: string, value: string | null) => {
    const u = new URLSearchParams(params.toString());
    if (value) u.set(key, value);
    else u.delete(key);
    router.replace(u.size ? `${path}?${u}` : path, { scroll: false });
  };

  const s = useMemo(() => insightStats(scoped, meta, TRIAGE_TABS[0]!.base), [scoped, meta]);

  const total = s.open.length;
  const pct = (n: number) => `${Math.round((n / Math.max(1, total)) * 100)}% of open`;
  const fieldBars = (field: "team" | "priority", m: Map<string, number>): Bar[] => {
    const opts = field === "priority" ? [...meta.fields.priority].reverse() : meta.fields[field];
    const bars: Bar[] = opts.map((o) => ({
      key: o.id,
      label: field === "team" ? plainName(o.name) || o.name : o.name,
      icon: field === "priority" ? <PriorityIcon option={o} total={meta.fields.priority.length} size={13} /> : <OptionDot color={o.color} size={7} />,
      n: m.get(o.id) ?? 0,
      href: href([OPEN, { field, op: "in", values: [o.id] }]),
    }));
    if (field === "team") bars.sort((a, b) => b.n - a.n);
    const none = m.get("∅") ?? 0;
    if (none) bars.push({ key: "∅", label: `No ${field}`, icon: <span className="size-[7px] rounded-full border border-dashed border-faint" />, n: none, href: href([OPEN, { field, op: "empty" }]) });
    return bars.filter((b) => b.n > 0 || field === "priority");
  };
  const topN = (m: Map<string, number>, n: number) => [...m.entries()].filter(([k]) => k !== "∅").sort((a, b) => b[1] - a[1]).slice(0, n);

  return (
    <Page title="Insights" icon={<Icon name="chart" size={15} />} actions={<ScopePicker scope={scope} onChange={(sc) => setParam("scope", scopeParam(sc) ?? "all")} />}>
      <div className="space-y-4 p-4 md:p-6">
        {missingView && <p className="rounded-lg bg-hover px-3 py-2 text-[12.5px] text-muted">That view doesn&apos;t exist any more, so this shows the whole repo.</p>}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <Tile label="Open issues" value={total} href={href([OPEN])} />
          <Tile label="Needs triage" value={s.triage} sub={`${pct(s.triage)} · no priority or team`} href={scope.kind === "all" ? "/triage" : href(TRIAGE_TABS[0]!.base)} tone={s.triage ? "warning" : undefined} />
          <Tile label="Not in a release" value={s.noRelease} sub={pct(s.noRelease)} href={scope.kind === "all" ? "/backlog" : href([OPEN, { field: "release", op: "empty" }])} />
          <Tile label="Stale" value={s.stale} sub="no update in 90+ days" href={scope.kind === "all" ? "/triage?tab=stale" : href(TRIAGE_TABS[4]!.base)} tone={s.stale ? "critical" : undefined} />
          <Tile label="Opened" value={s.created30} sub="last 30 days" href={href([{ field: "created", op: "within_days", days: 30 }], { sort: [{ field: "created", dir: "desc" }] })} />
          <Tile label="Closed" value={s.closed30} sub="last 30 days" href={href([{ field: "closed", op: "within_days", days: 30 }], { sort: [{ field: "updated", dir: "desc" }] })} />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <FlowChart issues={scoped} today={meta.today} />
          <BarList title="Open issues by team" total={total} bars={fieldBars("team", s.byTeam)} />
          <BarList title="Open issues by priority" total={total} bars={fieldBars("priority", s.byPriority)} />
          <BarList
            title="Open issues by type"
            total={total}
            bars={[
              ...meta.issueTypes.map((t) => ({ key: t.id, label: t.name, icon: <OptionDot color={t.color} size={7} />, n: s.byType.get(t.id) ?? 0, href: href([OPEN, { field: "type", op: "in", values: [t.id] }]) })),
              { key: "∅", label: "No type", icon: <span className="size-[7px] rounded-full border border-dashed border-faint" />, n: s.byType.get("∅") ?? 0, href: href([OPEN, { field: "type", op: "empty" }]) },
            ].filter((b) => b.n > 0)}
          />
          <BarList
            title="Age of open issues"
            note="Time since the issue was opened"
            total={total}
            bars={s.ages.map((a) => ({
              key: a.key,
              label: a.label,
              n: a.n,
              href: href(
                [OPEN, ...(a.lo > 0 ? [{ field: "created" as const, op: "older_than_days" as const, days: a.lo }] : []), ...(Number.isFinite(a.hi) ? [{ field: "created" as const, op: "within_days" as const, days: a.hi }] : [])],
                { sort: [{ field: "created", dir: "asc" }] },
              ),
            }))}
          />
          <BarList
            title="Open issues by assignee"
            note="Top 10"
            total={total}
            bars={[
              ...topN(s.byAssignee, 10).map(([login, n]) => ({ key: login, label: login, icon: <Avatar login={login} url={avatarOf(login)} size={15} />, n, href: href([OPEN, { field: "assignee", op: "in", values: [login] }]) })),
              ...(s.byAssignee.get("∅") ? [{ key: "∅", label: "Unassigned", icon: <Icon name="user" size={13} className="text-faint" />, n: s.byAssignee.get("∅")!, href: href([OPEN, { field: "assignee", op: "empty" }]) }] : []),
            ]}
          />
          <ReviewWait issues={scoped} scope={scope} days={days} onDays={(n) => setParam("days", n === 5 ? null : String(n))} />
          <BarList
            title="Open issues by label"
            note="Top 10"
            total={total}
            bars={topN(s.byLabel, 10).map(([id, n]) => ({
              key: id,
              label: meta.labels.find((l) => l.id === id)?.name ?? id,
              icon: <OptionDot color={meta.labels.find((l) => l.id === id)?.color} size={7} />,
              n,
              href: href([OPEN, { field: "label", op: "in", values: [id] }]),
            }))}
          />
        </div>
        <p className="text-[11.5px] text-faint">
          Counts are computed from the synced cache in your browser. Click any number or bar to open the matching issues.
        </p>
      </div>
    </Page>
  );
}
