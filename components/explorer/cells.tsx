"use client";

import { shortAgo, formatDate, plainName } from "@/lib/client/format";
import type { DisplayProp } from "@/lib/client/explorer";
import type { ClientIssue } from "@/lib/client/types";
import { Icon } from "../icons";
import { AvatarStack, Chip, OptionDot, PriorityIcon, ProgressRing, StatusIcon, TypeBadge } from "../props";
import { useAppData } from "../app/provider";

/** Cells shared by list rows, cards and table cells so all layouts agree. */
export function useCells() {
  const { data, option, avatarOf, labelColor, typeColor } = useAppData();
  const { meta } = data;
  const nStatus = meta.fields.status.length;
  const nPriority = meta.fields.priority.length;

  return {
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
    team: (i: ClientIssue) =>
      i.teamName ? (
        <Chip color={option("team", i.teamId)?.color} title={`Team: ${i.teamName}`}>
          {plainName(i.teamName) || i.teamName}
        </Chip>
      ) : null,
    platform: (i: ClientIssue) => (i.platformName ? <Chip title={`Platform: ${i.platformName}`}>{i.platformName}</Chip> : null),
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
    subissues: (i: ClientIssue) =>
      i.subTotal ? (
        <span className="inline-flex items-center gap-1 text-[11.5px] tabular-nums text-muted" title={`${i.subClosed} of ${i.subTotal} sub-issues closed`}>
          <ProgressRing done={i.subClosed} total={i.subTotal} />
          {i.subClosed}/{i.subTotal}
        </span>
      ) : null,
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
    teamDot: (i: ClientIssue) => (i.teamId ? <OptionDot color={option("team", i.teamId)?.color} /> : null),
  } satisfies Record<DisplayProp | "teamDot", unknown>;
}
