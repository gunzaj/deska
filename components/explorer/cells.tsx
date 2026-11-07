"use client";

import { shortAgo, formatDate, plainName } from "@/lib/client/format";
import { dimensionLabel, primaryDimension, type DisplayProp } from "@/lib/client/explorer";
import { PROGRESS_TOOLTIP, progressText, subProgress } from "@/lib/client/progress";
import { dimFieldId, isDimKey } from "@/lib/sync/field-map";
import type { ClientIssue, DimKey } from "@/lib/client/types";
import { Icon } from "../icons";
import { AvatarStack, Chip, OptionDot, PriorityIcon, ProgressRing, StatusIcon, TypeBadge } from "../props";
import { useAppData } from "../app/provider";

/** Cells shared by list rows, cards and table cells so all layouts agree. */
export function useCells() {
  const { data, option, avatarOf, labelColor, typeColor } = useAppData();
  const { meta } = data;
  const nStatus = meta.fields.status.length;
  const nPriority = meta.fields.priority.length;

  const cells = {
    status: (i: ClientIssue) => (
      <span title={i.state === "closed" ? `Closed${i.stateReason ? ` (${i.stateReason.replace("_", " ")})` : ""}` : (i.statusName ?? "No status")}>
        <StatusIcon option={option("status", i.statusId)} total={nStatus} state={i.state} stateReason={i.stateReason} />
      </span>
    ),
    priority: (i: ClientIssue) => (
      <span title={i.priorityName ?? "No priority"}>
        <PriorityIcon option={option("priority", i.priorityId)} total={nPriority} />
      </span>
    ),
    id: (i: ClientIssue) => <span className="font-mono text-[11.5px] tabular-nums text-faint">#{i.number}</span>,
    /** A mapped dimension's value (`dim:<fieldId>`), as a chip titled with the field's name. */
    dim: (key: DimKey, i: ClientIssue) => {
      const v = i.dims[dimFieldId(key)];
      if (!v) return null;
      const name = v.name ?? "Missing option";
      return (
        <Chip key={key} color={option(key, v.id)?.color} title={`${dimensionLabel(meta, key)}: ${name}`}>
          {plainName(name) || name}
        </Chip>
      );
    },
    /** Every dimension among `props`, except the one a board is laid out by. */
    dims: (i: ClientIssue, props: DisplayProp[], except?: string) => props.filter((p): p is DimKey => isDimKey(p) && p !== except).map((p) => cells.dim(p, i)),
    release: (i: ClientIssue) =>
      i.releaseName ? (
        <span
          title={`Release ${i.releaseName}`}
          className={`inline-flex h-5 items-center gap-1 rounded-full border px-2 text-[11.5px] font-medium ${
            i.releaseId === meta.currentReleaseId ? "border-brand-border/50 bg-brand-soft text-brand-text" : "border-line text-muted"
          }`}
        >
          <Icon name="calendar" size={11} />
          {i.releaseName}
        </span>
      ) : null,
    type: (i: ClientIssue) => (i.typeName ? <TypeBadge name={i.typeName} color={typeColor(i.typeId)} /> : null),
    labels: (i: ClientIssue, max = 2) =>
      i.labelIds.length ? (
        <span className="flex min-w-0 items-center gap-1">
          {i.labelIds.slice(0, max).map((id, k) => (
            <Chip key={id} color={labelColor(id)}>
              {i.labelNames[k]}
            </Chip>
          ))}
          {i.labelIds.length > max && (
            <span className="text-[11px] text-faint" title={i.labelNames.slice(max).join(", ")}>
              +{i.labelIds.length - max}
            </span>
          )}
        </span>
      ) : null,
    parent: (i: ClientIssue) =>
      i.parentNumber ? (
        <span title={`Epic #${i.parentNumber} ${i.parentTitle ?? ""}`} className="inline-flex h-5 max-w-[11rem] items-center gap-1 rounded-full border border-line px-2 text-[11.5px] text-muted">
          <Icon name="epic" size={11} className="shrink-0 text-violet" />
          <span className="truncate">{(i.parentTitle ?? `#${i.parentNumber}`).replace(/^Epic:\s*/i, "")}</span>
        </span>
      ) : null,
    subissues: (i: ClientIssue) => {
      const p = subProgress(i);
      if (p.kind === "none") return null;
      if (p.kind === "unloaded") return <span className="text-[11.5px] text-faint" data-sub-progress="unloaded">{progressText(p)}</span>;
      return (
        <span className="inline-flex items-center gap-1 text-[11.5px] tabular-nums text-muted" title={`${PROGRESS_TOOLTIP}: ${p.done} of ${p.total} sub-issues completed`} data-sub-progress="counted">
          <ProgressRing done={p.done} total={p.total} />
          {progressText(p)}
        </span>
      );
    },
    milestone: (i: ClientIssue) =>
      i.milestoneName ? (
        <span className="inline-flex items-center gap-1 text-[11.5px] text-muted">
          <Icon name="milestone" size={11} />
          {i.milestoneName}
        </span>
      ) : null,
    assignee: (i: ClientIssue) =>
      i.assignees.length ? (
        <span title={i.assignees.join(", ")}>
          <AvatarStack logins={i.assignees} urlOf={avatarOf} size={18} />
        </span>
      ) : (
        <span title="Unassigned" className="grid size-[18px] place-items-center rounded-full border border-dashed border-line-field text-faint">
          <Icon name="user" size={10} />
        </span>
      ),
    created: (i: ClientIssue) => (
      <span className="text-[11.5px] tabular-nums text-faint" title={`Created ${formatDate(i.createdAt)}`}>
        {shortAgo(i.createdAt)}
      </span>
    ),
    updated: (i: ClientIssue) => (
      <span className="w-12 text-right text-[11.5px] tabular-nums text-faint" title={`Updated ${new Date(i.updatedAt).toLocaleString()}`}>
        {shortAgo(i.updatedAt)}
      </span>
    ),
    /** A dot in the color of the first dimension's value. */
    dimDot: (i: ClientIssue) => {
      const d = primaryDimension(meta);
      const v = d ? i.dims[d.id] : undefined;
      return d && v ? <OptionDot color={option(d.key, v.id)?.color} /> : null;
    },
  } satisfies Record<Exclude<DisplayProp, DimKey> | "dim" | "dims" | "dimDot", unknown>;
  return cells;
}
