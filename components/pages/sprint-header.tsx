"use client";

// The header of a sprint page (§4.5): Done X / Y and %, days left, counts by
// Status and the scope added since the start. Filters change the numbers, and
// the header says so.
import { useMemo } from "react";
import { daysBetween, formatDate, lastDay, plainName, pluralize } from "@/lib/client/format";
import { filterSummary, sprintStats, sprintTiming } from "@/lib/client/sprint";
import type { ClientIssue, ClientRelease } from "@/lib/client/types";
import type { Filter } from "@/lib/views/view";
import { useAppData } from "../app/provider";
import { OptionDot } from "../props";
import { useScopeAdded } from "./release-risk";

export function SprintHeader({ sprint, all, rows, filtered, filters }: { sprint: ClientRelease; all: ClientIssue[]; rows: ClientIssue[]; filtered: boolean; filters: Filter[] }) {
  const { data } = useAppData();
  const { meta } = data;
  const stats = useMemo(() => sprintStats(rows, meta), [rows, meta]);
  const scope = useScopeAdded(sprint);
  const added = useMemo(() => {
    const ids = new Set(scope.ids);
    return rows.filter((i) => ids.has(i.nodeId)).length;
  }, [rows, scope.ids]);
  const timing = sprintTiming(sprint, meta.today);
  const end = lastDay(sprint.endDate);
  const when =
    timing.phase === "current"
      ? `${timing.daysLeft} day${timing.daysLeft === 1 ? "" : "s"} left`
      : timing.phase === "upcoming"
        ? `starts in ${timing.startsIn} day${timing.startsIn === 1 ? "" : "s"}`
        : `ended ${formatDate(end)}`;
  const elapsed = timing.phase === "current" ? Math.min(1, Math.max(0, daysBetween(sprint.startDate, meta.today) / sprint.duration)) : null;
  const label = filtered ? filterSummary(filters, meta, data.issues) : "";

  return (
    <div className="shrink-0 border-b border-line px-4 py-2.5" data-sprint-header data-release-summary data-filtered={filtered || undefined}>
      <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
        <div>
          <p className="text-[22px] font-medium leading-none tracking-tight tabular-nums" data-sprint-done>
            {stats.done} / {stats.counted}
            {stats.pct != null && <span className="ml-2 text-[15px] text-muted">{stats.pct}%</span>}
          </p>
          <p className="mt-1 text-[12px] text-muted">
            done
            {filtered && (
              <>
                {" · "}
                <span data-sprint-filtered>
                  {label ? `${label} · ` : ""}
                  {rows.length} / {all.length} (filtered)
                </span>
              </>
            )}
          </p>
        </div>
        <dl className="flex flex-wrap gap-x-5 gap-y-1 text-[12px]">
          <div>
            <dt className="text-faint">Remaining</dt>
            <dd className="text-[14px] font-semibold tabular-nums" data-sprint-remaining>
              {stats.remaining}
            </dd>
          </div>
          <div>
            <dt className="text-faint">Not planned</dt>
            <dd className="text-[14px] font-semibold tabular-nums text-muted" data-sprint-not-planned title="Closed as not planned: left out of the percentage">
              {stats.notPlanned}
            </dd>
          </div>
          <div>
            <dt className="text-faint">Scope added</dt>
            <dd className="text-[14px] font-semibold tabular-nums" data-sprint-added title="Put into the sprint after it started">
              {scope.loaded ? added : "…"}
            </dd>
          </div>
          <div>
            <dt className="text-faint">
              {formatDate(sprint.startDate)} – {formatDate(end)}
            </dt>
            <dd className="text-[14px] font-semibold" data-sprint-when>
              {when}
            </dd>
          </div>
        </dl>
      </div>
      <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-active" role="img" aria-label={stats.pct == null ? "Nothing to count yet" : `${stats.done} of ${stats.counted} done`}>
        {stats.counted > 0 && <span className="block h-full rounded-full bg-brand-border" style={{ width: `${stats.pct}%` }} />}
      </div>
      {elapsed != null && (
        <div className="relative mt-1 h-0.5 rounded-full bg-active" title={`${Math.round(elapsed * 100)}% of the sprint's time has passed`}>
          <span className="absolute inset-y-0 left-0 rounded-full bg-fg/30" style={{ width: `${elapsed * 100}%` }} />
        </div>
      )}
      {stats.byStatus.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-muted" aria-label="Open issues by Status" data-sprint-statuses>
          {stats.byStatus.map((s) => {
            const o = s.id ? meta.fields.status.find((x) => x.id === s.id) : null;
            return (
              <li key={s.id ?? "none"} className="flex items-center gap-1.5">
                <OptionDot color={o?.color} size={7} />
                {o ? plainName(o.name) || o.name : "No status"}
                <span className="tabular-nums text-faint">{s.n}</span>
              </li>
            );
          })}
        </ul>
      )}
      {filtered && rows.length === 0 && <p className="mt-1 text-[12px] text-faint">No issues match the filters ({pluralize(all.length, "issue")} in the sprint).</p>}
    </div>
  );
}
