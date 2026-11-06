"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { DEFAULT_PROPS, encodeState } from "@/lib/client/explorer";
import { DEFAULT_PR_STATE } from "@/lib/client/prs";
import { narrowed, sourceRows } from "@/lib/client/project-source";
import type { ProjectSource, Task, TaskProject } from "@/lib/tasks/model";
import type { PrFilter } from "@/lib/views/pr-view";
import type { Filter } from "@/lib/views/view";
import { useAppData } from "../app/provider";
import { useOpenIssue } from "../app/open-issue";
import { AddFilter, FilterChips } from "../explorer/filter-bar";
import { IssueRow } from "../explorer/layouts";
import { Icon } from "../icons";
import { PrFilterChips, PrRow } from "../prs/explorer";
import { usePrs } from "../prs/store";
import { btn } from "../ui/popover";
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
 * The GitHub half of a task project (SPEC §12.3): issues and PRs matching the
 * project's saved filters, live from the cache. Items an open task in this
 * project already links are left out, since the task stands for them.
 */
export function ProjectSourceSection({ project, tasks }: { project: TaskProject; tasks: Task[] }) {
  const { data } = useAppData();
  const { prs, loaded: prsLoaded, ctx, error: prsError, retry: retryPrs } = usePrs();
  const { updateProject } = useTasks();
  const openIssue = useOpenIssue();
  const openByIssue = useCallback((i: { number: number }) => openIssue(i.number), [openIssue]);
  const [allIssues, setAllIssues] = useState(false);
  const [allPrs, setAllPrs] = useState(false);
  // Filter edits show at once; the saved project catches up after the PATCH.
  const [source, setSource] = useState(project.source);
  // A reload landing while a save is in flight must not snap the edits back.
  const saving = useRef(false);
  const savedSource = useRef(project.source);
  savedSource.current = project.source;
  useEffect(() => {
    if (!saving.current) setSource(project.source);
  }, [project.source]);
  const rows = useMemo(() => sourceRows(source, tasks, { meta: data.meta, issues: data.issues, prs, prCtx: ctx }), [source, tasks, data, prs, ctx]);
  if (!source) return null;

  const save = (next: ProjectSource) => {
    const value = next.issues || next.prs ? next : null;
    setSource(value);
    saving.current = true;
    void updateProject(project.id, { source: value }).then((ok) => {
      saving.current = false;
      if (!ok) setSource(savedSource.current);
    });
  };
  const setIssues = (issues: Filter[] | null) => save({ ...source, issues });
  const setPrs = (prsFilters: PrFilter[] | null) => save({ ...source, prs: prsFilters });
  const issueRows = allIssues ? rows.issues : rows.issues.slice(0, PAGE);
  const prRows = allPrs ? rows.prs : rows.prs.slice(0, PAGE);

  return (
    <>
      {source.issues && (
        <Section
          title="Issues"
          count={narrowed(source.issues) ? rows.issues.length : null}
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
          ) : rows.issues.length === 0 ? (
            <Hint>No issues match, or every match already has a task here.</Hint>
          ) : (
            <div role="table" aria-label="Issues in this project">
              {issueRows.map((i) => (
                <div key={i.nodeId} className="group/gh relative h-11">
                  <IssueRow issue={i} props={DEFAULT_PROPS} focused={false} onOpen={openByIssue} onFocus={NOOP} />
                  <AddTaskButton number={i.number} projectId={project.id} />
                </div>
              ))}
              <More shown={issueRows.length} total={rows.issues.length} onMore={() => setAllIssues(true)} />
            </div>
          )}
        </Section>
      )}
      {source.prs && (
        <Section
          title="Pull requests"
          count={narrowed(source.prs) && prsLoaded ? rows.prs.length : null}
          explore={`/pulls?s=${encodeState({ ...DEFAULT_PR_STATE, filters: source.prs } as never)}`}
          onRemove={() => setPrs(null)}
          filters={<PrFilterChips filters={source.prs} onChange={setPrs} withState />}
        >
          {!narrowed(source.prs) ? (
            <Hint>Add a filter, such as an author, label or review request, to pull matching pull requests into this project.</Hint>
          ) : !prsLoaded ? (
            prsError ? (
              <Hint>
                Couldn&apos;t load pull requests ({prsError}).{" "}
                <button type="button" onClick={() => void retryPrs()} className="font-medium text-fg underline">
                  Retry
                </button>
              </Hint>
            ) : (
              <Hint>Loading pull requests…</Hint>
            )
          ) : rows.prs.length === 0 ? (
            <Hint>No pull requests match, or every match already has a task here.</Hint>
          ) : (
            <div aria-label="Pull requests in this project">
              {prRows.map((p) => (
                <ul key={p.nodeId} className="group/gh relative">
                  <PrRow pr={p} focused={false} active={false} onFocus={NOOP} />
                  <AddTaskButton number={p.number} projectId={project.id} />
                </ul>
              ))}
              <More shown={prRows.length} total={rows.prs.length} onMore={() => setAllPrs(true)} />
            </div>
          )}
        </Section>
      )}
      {(!source.issues || !source.prs) && (
        <div className="flex gap-1.5 px-4 py-2">
          {!source.issues && (
            <button type="button" onClick={() => setIssues([{ field: "state", op: "in", values: ["open"] }])} className={btn.ghost}>
              <Icon name="plus" size={13} /> Pull in issues
            </button>
          )}
          {!source.prs && (
            <button type="button" onClick={() => setPrs([{ field: "state", values: ["open", "draft"] }])} className={btn.ghost}>
              <Icon name="plus" size={13} /> Pull in pull requests
            </button>
          )}
        </div>
      )}
    </>
  );
}
