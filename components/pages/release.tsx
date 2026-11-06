"use client";

import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { daysBetween, formatDate, lastDay } from "@/lib/client/format";
import { PRESETS } from "@/lib/client/presets";
import type { Filter } from "@/lib/views/view";
import { useAppData } from "../app/provider";
import { Page } from "../app/shell";
import { Explorer } from "../explorer/explorer";
import { Icon } from "../icons";
import { ReleaseNotesButton } from "./release-notes";
import { ReleaseRisk } from "./release-risk";
import { EmptyHint } from "../props";
import { PickList, Popover, btn } from "../ui/popover";

function ReleasePicker({ currentId }: { currentId: string }) {
  const { data } = useAppData();
  const router = useRouter();
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const { meta } = data;
  return (
    <>
      <button ref={ref} type="button" onClick={() => setOpen(true)} className={btn.outline}>
        <Icon name="calendar" size={13} />
        Switch release
        <Icon name="chevronDown" size={12} className="text-faint" />
      </button>
      <Popover anchor={ref} open={open} onClose={() => setOpen(false)} align="end" width={260}>
        <PickList
          placeholder="Find a release…"
          items={[...meta.releases].reverse().map((r) => ({
            id: r.id,
            label: r.title,
            checked: r.id === currentId,
            hint: r.id === meta.currentReleaseId ? "current" : `${formatDate(r.startDate)}`,
          }))}
          onPick={(id) => {
            setOpen(false);
            router.push(`/releases/${id}`);
          }}
        />
      </Popover>
    </>
  );
}

export function ReleasePage({ id }: { id: string }) {
  const { data, release } = useAppData();
  const r = release(id);
  const base = useMemo<Filter[]>(() => [{ field: "release", op: "in", values: [id] }], [id]);
  const stats = useMemo(() => {
    const items = data.issues.filter((i) => i.releaseId === id);
    const closed = items.filter((i) => i.state === "closed").length;
    return { total: items.length, closed };
  }, [data.issues, id]);
  if (!r) {
    return (
      <Page title="Release not found">
        <EmptyHint icon="calendar" title="This release does not exist in the project" />
      </Page>
    );
  }
  const today = data.meta.today;
  const isCurrent = r.id === data.meta.currentReleaseId;
  const left = daysBetween(today, r.endDate);
  const pct = stats.total ? Math.round((stats.closed / stats.total) * 100) : 0;
  // endDate is exclusive: the release's last day is the day before.
  const end = lastDay(r.endDate);
  const when = today < r.startDate ? `starts ${formatDate(r.startDate)}` : today >= r.endDate ? `ended ${formatDate(end)}` : `${left} day${left === 1 ? "" : "s"} left`;

  return (
    <Explorer
      key={id}
      title={
        <span className="flex items-center gap-2">
          Release {r.title}
          {isCurrent && <span className="rounded-full bg-brand-soft px-1.5 py-px text-[10.5px] font-semibold text-brand-text">Current</span>}
          <span className="hidden items-center gap-2 text-[12px] font-normal text-faint sm:flex">
            {formatDate(r.startDate)} – {formatDate(end)} · {when}
            <span className="flex items-center gap-1.5" title={`${stats.closed} of ${stats.total} closed`}>
              <span className="h-1.5 w-16 overflow-hidden rounded-full bg-active">
                <span className="block h-full rounded-full bg-brand-border" style={{ width: `${pct}%` }} />
              </span>
              {pct}%
            </span>
          </span>
        </span>
      }
      summary={
        <>
        <div className="flex shrink-0 items-center gap-3 border-b border-line px-4 py-1.5 text-[12px] text-faint sm:hidden" data-release-summary>
          <span className="min-w-0 flex-1 truncate">
            {formatDate(r.startDate)} – {formatDate(end)} · {when}
          </span>
          <span className="flex shrink-0 items-center gap-1.5" title={`${stats.closed} of ${stats.total} closed`}>
            <span className="h-1.5 w-16 overflow-hidden rounded-full bg-active">
              <span className="block h-full rounded-full bg-brand-border" style={{ width: `${pct}%` }} />
            </span>
            {pct}%
          </span>
        </div>
        <ReleaseRisk release={r} />
        </>
      }
      icon={<Icon name="calendar" size={15} />}
      base={base}
      defaults={PRESETS.release}
      headerExtra={
        <>
          <ReleaseNotesButton release={r} />
          <ReleasePicker currentId={id} />
        </>
      }
      dropRelease={id}
      emptyTitle="Nothing planned in this release yet"
    />
  );
}
