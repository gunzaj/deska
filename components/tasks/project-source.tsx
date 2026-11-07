"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { DEFAULT_PROPS, encodeState } from "@/lib/client/explorer";
import { narrowed, sourceRows } from "@/lib/client/project-source";
import type { ProjectSource, Task, TaskProject } from "@/lib/tasks/model";
import type { Filter } from "@/lib/views/view";
import { useAppData } from "../app/provider";
import { useOpenIssue } from "../app/open-issue";
import { AddFilter, FilterChips } from "../explorer/filter-bar";
import { IssueRow } from "../explorer/layouts";
import { Icon } from "../icons";
import { useTasks } from "./store";

const PAGE = 50;
const NOOP = () => {};

/** Hover action on a GitHub row: file a task for it in this project. */
function AddTaskButton({ number, projectId }: { number: number; projectId: string }) {
  const { openCompose } = useTasks();
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        openCompose({ links: [number], projectId });
      }}
      className="absolute right-3 top-1/2 hidden -translate-y-1/2 items-center gap-1 rounded-md border border-line bg-surface px-2 py-1 text-[12px] font-medium text-muted shadow-raised hover:text-fg group-hover/gh:inline-flex"
      aria-label={`Add task for #${number}`}
      title="Add a task for this to the project"
    >
      <Icon name="plus" size={12} /> Task
    </button>
  );
}

function Section({ title, count, filters, explore, onRemove, children }: { title: string; count: number | null; filters: ReactNode; explore: string; onRemove: () => void; children: ReactNode }) {
  return (
    <section aria-label={title}>
      <h2 className="sticky top-0 z-10 flex h-8 items-center gap-2 border-b border-line bg-surface px-4 text-[12px] font-semibold text-muted">
        <Icon name="git" size={12} className="text-faint" />
        {title}
        {count != null && <span className="font-normal tabular-nums text-faint">{count}</span>}
        <span className="flex-1" />
        <Link href={explore} className="font-normal text-faint hover:text-fg" title="Open these filters in the explorer">
          Open in explorer
        </Link>
        <button type="button" onClick={onRemove} className="grid size-5 place-items-center rounded text-faint hover:bg-hover hover:text-fg" aria-label={`Stop pulling in ${title.toLowerCase()}`} title="Stop pulling these in">
          <Icon name="x" size={12} />
        </button>
      </h2>
      <div className="flex flex-wrap items-center gap-1.5 border-b border-line-soft px-4 py-2">{filters}</div>
      {children}
    </section>
  );
}

function More({ shown, total, onMore }: { shown: number; total: number; onMore: () => void }) {
  if (shown >= total) return null;
  return (
    <button type="button" onClick={onMore} className="w-full border-b border-line-soft px-4 py-2 text-left text-[12.5px] text-muted hover:bg-hover hover:text-fg">
      Show all {total}
    </button>
  );
}

function Hint({ children }: { children: ReactNode }) {
  return <p className="border-b border-line-soft px-4 py-3 text-[12.5px] text-faint">{children}</p>;
}

/**
 * The GitHub half of a task project (SPEC §12.3): issues matching the
 * project's saved filters, live from the cache. Issues an open task in this
 * project already links are left out, since the task stands for them.
 */
export function ProjectSourceSection({ project, tasks }: { project: TaskProject; tasks: Task[] }) {
  const { data } = useAppData();
  const { updateProject } = useTasks();
  const openIssue = useOpenIssue();
  const openByIssue = useCallback((i: { number: number }) => openIssue(i.number), [openIssue]);
  const [allIssues, setAllIssues] = useState(false);
  // Filter edits show at once; the saved project catches up after the PATCH.
  const [source, setSource] = useState(project.source);
  // A reload landing while a save is in flight must not snap the edits back.
  const saving = useRef(false);
  const savedSource = useRef(project.source);
  savedSource.current = project.source;
  useEffect(() => {
    if (!saving.current) setSource(project.source);
  }, [project.source]);
  const rows = useMemo(() => sourceRows(source, tasks, { meta: data.meta, issues: data.issues }), [source, tasks, data]);
  if (!source?.issues) return null;

  const setIssues = (issues: Filter[] | null) => {
    const value: ProjectSource | null = issues ? { issues } : null;
    setSource(value);
    saving.current = true;
    void updateProject(project.id, { source: value }).then((ok) => {
      saving.current = false;
      if (!ok) setSource(savedSource.current);
    });
  };
  const issueRows = allIssues ? rows : rows.slice(0, PAGE);

  return (
    <Section
      title="Issues"
      count={narrowed(source.issues) ? rows.length : null}
      explore={`/issues?s=${encodeState({ filters: source.issues, sort: [{ field: "updated", dir: "desc" }], layout: "list" })}`}
      onRemove={() => setIssues(null)}
      filters={
        <>
          <FilterChips filters={source.issues} onChange={setIssues} pool={data.issues} />
          <AddFilter filters={source.issues} onChange={setIssues} pool={data.issues} />
        </>
      }
    >
      {!narrowed(source.issues) ? (
        <Hint>Add a filter, such as a label, epic or assignee, to pull matching issues into this project.</Hint>
      ) : rows.length === 0 ? (
        <Hint>No issues match, or every match already has a task here.</Hint>
      ) : (
        <div role="table" aria-label="Issues in this project">
          {issueRows.map((i) => (
            <div key={i.nodeId} className="group/gh relative h-11">
              <IssueRow issue={i} props={DEFAULT_PROPS} focused={false} onOpen={openByIssue} onFocus={NOOP} />
              <AddTaskButton number={i.number} projectId={project.id} />
            </div>
          ))}
          <More shown={issueRows.length} total={rows.length} onMore={() => setAllIssues(true)} />
        </div>
      )}
    </Section>
  );
}
