"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { EDITING_OFF } from "@/lib/client/edit";
import type { ExplorerState } from "@/lib/client/explorer";
import { keyboardBusy } from "@/lib/client/keyboard";
import { formatDate } from "@/lib/client/format";
import { PRESETS } from "@/lib/client/presets";
import type { Filter } from "@/lib/views/view";
import { connectionProblem, problemHint, useConnection } from "../app/connection";
import { useAppData } from "../app/provider";
import { Page } from "../app/shell";
import { Explorer } from "../explorer/explorer";
import { Icon } from "../icons";
import { neighbour } from "@/lib/client/sprint";
import { ReleaseNotesButton } from "./release-notes";
import { ReleaseRisk } from "./release-risk";
import { SprintHeader } from "./sprint-header";
import { EmptyHint, Kbd } from "../props";
import { PickList, Popover, btn } from "../ui/popover";

/** Board by Status (default) or list; the list groups into Remaining, Done and Not planned (§4.5). */
const SPRINT_DEFAULTS: ExplorerState = { ...PRESETS.release, groupBy: "sprintState" };

function ReleasePicker({ currentId }: { currentId: string }) {
  const { data } = useAppData();
  const router = useRouter();
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const { meta } = data;
  const prev = neighbour(meta.releases, currentId, -1);
  const next = neighbour(meta.releases, currentId, 1);
  // `[` and `]` step to the previous and next sprint by date.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || (e.key !== "[" && e.key !== "]") || keyboardBusy(e)) return;
      const to = e.key === "[" ? prev : next;
      if (!to) return;
      e.preventDefault();
      router.push(`/releases/${to}`);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [prev, next, router]);
  return (
    <>
      <button type="button" disabled={!prev} onClick={() => prev && router.push(`/releases/${prev}`)} className={btn.outline} aria-label="Previous sprint" title="Previous sprint ([)">
        <Icon name="chevronLeft" size={13} />
      </button>
      <button type="button" disabled={!next} onClick={() => next && router.push(`/releases/${next}`)} className={btn.outline} aria-label="Next sprint" title="Next sprint (])">
        <Icon name="chevronRight" size={13} />
      </button>
      <button ref={ref} type="button" onClick={() => setOpen(true)} className={btn.outline}>
        <Icon name="calendar" size={13} />
        Switch release
        <Icon name="chevronDown" size={12} className="text-faint" />
        <Kbd>[ ]</Kbd>
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
  const { status: connection } = useConnection();
  const r = release(id);
  const base = useMemo<Filter[]>(() => [{ field: "release", op: "in", values: [id] }], [id]);
  const inSprint = useMemo(() => data.issues.filter((i) => i.releaseId === id), [data.issues, id]);
  if (!r) {
    return (
      <Page title="Release not found">
        <EmptyHint icon="calendar" title="This release does not exist in the project" />
      </Page>
    );
  }
  const isCurrent = r.id === data.meta.currentReleaseId;
  // An unreadable project is its own message, never an empty sprint (§3.3).
  if (inSprint.length === 0 && connectionProblem(connection)) {
    return (
      <Page title={`Release ${r.title}`} icon={<Icon name="calendar" size={15} />} actions={<ReleasePicker currentId={id} />}>
        <div data-sprint-unreadable>
          <EmptyHint
            icon="alert"
            title={connection!.message ?? "Can't read this project from GitHub"}
            hint={problemHint(connection!) ?? "The sprint's issues can't be loaded, so nothing is shown for it."}
          />
        </div>
      </Page>
    );
  }
  const readOnly = !data.meta.writeMode;

  return (
    <Explorer
      key={id}
      title={
        <span className="flex items-center gap-2">
          Release {r.title}
          {isCurrent && <span className="rounded-full bg-brand-soft px-1.5 py-px text-[10.5px] font-semibold text-brand-text">Current</span>}
        </span>
      }
      summary={({ rows, filtered, filters }) => (
        <>
          <SprintHeader sprint={r} all={inSprint} rows={rows} filtered={filtered} filters={filters} />
          <ReleaseRisk release={r} />
        </>
      )}
      icon={<Icon name="calendar" size={15} />}
      base={base}
      defaults={SPRINT_DEFAULTS}
      headerExtra={
        <>
          {readOnly && (
            // Planning stays visible, disabled, with the reason (§4.5).
            <button type="button" disabled data-planning-disabled title={data.meta.editOffReason ?? EDITING_OFF} className={btn.outline}>
              <Icon name="lock" size={12} />
              Bulk edit
              <span className="text-faint">{data.meta.editOffReason ?? EDITING_OFF}</span>
            </button>
          )}
          <ReleaseNotesButton release={r} />
          <ReleasePicker currentId={id} />
        </>
      }
      dropRelease={id}
      emptyTitle="Nothing planned in this sprint yet"
      emptyHint="Issues get a Sprint on GitHub; they show up here after the next sync."
    />
  );
}
