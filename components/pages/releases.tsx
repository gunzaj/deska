"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { optionColor } from "@/lib/client/colors";
import { primaryDimension } from "@/lib/client/explorer";
import { daysBetween, formatDate, lastDay, plainName } from "@/lib/client/format";
import type { ClientIssue, ClientRelease } from "@/lib/client/types";
import { useAppData } from "../app/provider";
import { Page } from "../app/shell";
import { Icon } from "../icons";
import { OptionDot, StatusIcon } from "../props";
import { btn } from "../ui/popover";

type Phase = "current" | "upcoming" | "past";

function phaseOf(r: ClientRelease, today: string, currentId: string | null): Phase {
  if (r.id === currentId) return "current";
  return r.startDate > today ? "upcoming" : "past";
}

/** Status mix as a segmented bar: one segment per Status option, closed last. */
function StatusBar({ issues }: { issues: ClientIssue[] }) {
  const { data } = useAppData();
  const total = issues.length;
  if (!total) return <div className="h-2 rounded-full bg-active" />;
  const opts = data.meta.fields.status;
  const segs = [
    ...opts.map((o) => ({ key: o.id, label: o.name, color: optionColor(o.color), n: issues.filter((i) => i.state === "open" && i.statusId === o.id).length })),
    { key: "none", label: "No status", color: "var(--border-field)", n: issues.filter((i) => i.state === "open" && !i.statusId).length },
    { key: "closed", label: "Closed", color: "#8c6fe6", n: issues.filter((i) => i.state === "closed").length },
  ].filter((s) => s.n > 0);
  return (
    <div className="flex h-2 gap-[2px] overflow-hidden rounded-full" role="img" aria-label={segs.map((s) => `${s.label}: ${s.n}`).join(", ")}>
      {segs.map((s) => (
        <span key={s.key} title={`${plainName(s.label) || s.label}: ${s.n}`} className="h-full first:rounded-l-full last:rounded-r-full" style={{ width: `${(s.n / total) * 100}%`, background: s.color, minWidth: 3 }} />
      ))}
    </div>
  );
}

function ReleaseCard({ r, phase, issues }: { r: ClientRelease; phase: Phase; issues: ClientIssue[] }) {
  const { data, option } = useAppData();
  const { meta } = data;
  const closed = issues.filter((i) => i.state === "closed").length;
  const open = issues.length - closed;
  const pct = issues.length ? Math.round((closed / issues.length) * 100) : 0;
  const high = meta.fields.priority.at(-1)?.id;
  const urgent = issues.filter((i) => i.state === "open" && i.priorityId === high).length;
  const unassigned = issues.filter((i) => i.state === "open" && !i.assignees.length).length;
  // Open issues by the first mapped dimension's value (e.g. per team).
  const dim = primaryDimension(meta);
  const teams = useMemo(() => {
    const m = new Map<string, number>();
    if (dim) for (const i of issues) {
      const v = i.dims[dim.id]?.id;
      if (v && i.state === "open") m.set(v, (m.get(v) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  }, [issues, dim]);
  const elapsed = Math.min(1, Math.max(0, daysBetween(r.startDate, meta.today) / r.duration));
  const left = daysBetween(meta.today, r.endDate);
  const until = daysBetween(meta.today, r.startDate);

  return (
    <Link
      href={`/releases/${r.id}`}
      className={`group block rounded-xl border bg-surface p-4 shadow-raised transition-colors hover:border-line-field ${phase === "current" ? "border-brand-border/60" : "border-line"}`}
    >
      <div className="flex items-center gap-2">
        <Icon name="calendar" size={15} className={phase === "current" ? "text-brand-text" : "text-faint"} />
        <h2 className="text-[15px] font-semibold">Release {r.title}</h2>
        {phase === "current" && <span className="rounded-full bg-brand-soft px-1.5 text-[10.5px] font-semibold text-brand-text">Current</span>}
        <span className="flex-1" />
        <Icon name="chevronRight" size={14} className="text-faint transition-transform group-hover:translate-x-0.5" />
      </div>
      <p className="mt-1 text-[12px] text-faint">
        {formatDate(r.startDate)} – {formatDate(lastDay(r.endDate))} ·{" "}
        {phase === "current" ? `${left} day${left === 1 ? "" : "s"} left` : phase === "upcoming" ? `starts in ${until} day${until === 1 ? "" : "s"}` : "ended"}
      </p>

      <div className="mt-4 flex items-end justify-between gap-3">
        <div>
          <p className="text-[24px] font-medium leading-none tracking-tight tabular-nums">{pct}%</p>
          <p className="mt-1 text-[12px] text-muted">
            {closed} of {issues.length} closed
          </p>
        </div>
        <div className="flex gap-4 text-right text-[12px]">
          <div>
            <p className="text-[15px] font-semibold tabular-nums">{open}</p>
            <p className="text-faint">open</p>
          </div>
          <div>
            <p className={`text-[15px] font-semibold tabular-nums ${urgent ? "text-critical" : ""}`}>{urgent}</p>
            <p className="text-faint">high prio</p>
          </div>
          <div>
            <p className={`text-[15px] font-semibold tabular-nums ${unassigned ? "text-warning" : ""}`}>{unassigned}</p>
            <p className="text-faint">unassigned</p>
          </div>
        </div>
      </div>

      <div className="mt-3">
        <StatusBar issues={issues} />
        {phase === "current" && (
          <div className="relative mt-1.5 h-1 rounded-full bg-active" title={`${Math.round(elapsed * 100)}% of the release time elapsed`}>
            <span className="absolute inset-y-0 left-0 rounded-full bg-fg/30" style={{ width: `${elapsed * 100}%` }} />
          </div>
        )}
      </div>

      {teams.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-muted">
          {teams.map(([id, n]) => (
            <span key={id} className="flex items-center gap-1.5">
              <OptionDot color={option(dim!.key, id)?.color} size={7} />
              {plainName(option(dim!.key, id)?.name ?? "") || option(dim!.key, id)?.name}
              <span className="tabular-nums text-faint">{n}</span>
            </span>
          ))}
        </div>
      )}
    </Link>
  );
}

export function ReleasesPage() {
  const { data } = useAppData();
  const { meta, issues } = data;
  const [showPast, setShowPast] = useState(3);
  const byRelease = useMemo(() => {
    const m = new Map<string, ClientIssue[]>();
    for (const i of issues) {
      if (!i.releaseId) continue;
      const list = m.get(i.releaseId);
      if (list) list.push(i);
      else m.set(i.releaseId, [i]);
    }
    return m;
  }, [issues]);
  const all = [...meta.releases].map((r) => ({ r, phase: phaseOf(r, meta.today, meta.currentReleaseId) }));
  const current = all.filter((x) => x.phase === "current");
  const upcoming = all.filter((x) => x.phase === "upcoming");
  const past = all.filter((x) => x.phase === "past").reverse();

  const section = (title: string, list: typeof all) =>
    list.length > 0 && (
      <section>
        <h2 className="mb-2.5 text-[12.5px] font-semibold text-muted">{title}</h2>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {list.map(({ r, phase }) => (
            <ReleaseCard key={r.id} r={r} phase={phase} issues={byRelease.get(r.id) ?? []} />
          ))}
        </div>
      </section>
    );

  return (
    <Page
      title="Releases"
      icon={<Icon name="rocket" size={15} />}
      actions={
        <Link href="/releases/plan" className={btn.ghost}>
          <Icon name="list" size={14} />
          Plan
        </Link>
      }
    >
      <div className="space-y-8 p-4 md:p-6">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px] text-muted" aria-label="Legend">
          {meta.fields.status.map((o) => (
            <span key={o.id} className="flex items-center gap-1.5">
              <StatusIcon option={o} total={meta.fields.status.length} size={12} />
              {o.name}
            </span>
          ))}
          <span className="flex items-center gap-1.5">
            <StatusIcon option={null} total={0} state="closed" size={12} /> Closed
          </span>
        </div>
        {section("In progress", current)}
        {section("Upcoming", upcoming)}
        {section("Recent", past.slice(0, showPast))}
        {past.length > showPast && (
          <button type="button" onClick={() => setShowPast(past.length)} className={btn.ghost}>
            Show {past.length - showPast} older releases
          </button>
        )}
      </div>
    </Page>
  );
}
