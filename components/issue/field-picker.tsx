"use client";

// A property in the issue panel that opens a picker (W2). Options come from
// the discovered metadata, by ID, shown with their current names.
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { EditField } from "@/lib/client/edit";
import type { ClientIssue } from "@/lib/client/types";
import { useAppData } from "../app/provider";
import { Icon } from "../icons";
import { Avatar, OptionDot, PriorityIcon, StatusIcon } from "../props";
import { PickList, Popover, type PickItem } from "../ui/popover";
import { useIssueEdits } from "./edits";

const NONE = "__none";

/** Ask the open issue panel to open one of its pickers (the a/p/r keys, U3). */
export const OPEN_PICKER_EVENT = "deska:open-picker";
export function openPicker(nodeId: string, field: EditField) {
  window.dispatchEvent(new CustomEvent(OPEN_PICKER_EVENT, { detail: { nodeId, field } }));
}

export function usePickItems(issue: ClientIssue, field: EditField): { items: PickItem[]; multi: boolean } {
  const { data, avatarOf } = useAppData();
  const meta = data.meta;
  const none = (label: string, checked: boolean): PickItem => ({ id: NONE, label, checked, icon: <Icon name="x" size={12} className="text-faint" /> });
  switch (field) {
    case "status":
    case "priority":
    case "team":
    case "platform": {
      const options = meta.fields[field];
      const cur = field === "status" ? issue.statusId : field === "priority" ? issue.priorityId : field === "team" ? issue.teamId : issue.platformId;
      return {
        multi: false,
        items: [
          ...options.map((o) => ({
            id: o.id,
            label: o.name,
            checked: o.id === cur,
            icon: field === "status" ? <StatusIcon option={o} total={options.length} /> : field === "priority" ? <PriorityIcon option={o} total={options.length} /> : <OptionDot color={o.color} />,
          })),
          none(`No ${field}`, cur == null),
        ],
      };
    }
    case "release":
      return {
        multi: false,
        items: [
          ...[...meta.releases]
            .reverse()
            .map((r) => ({ id: r.id, label: r.title, checked: r.id === issue.releaseId, hint: r.id === meta.currentReleaseId ? "current" : r.id === meta.nextReleaseId ? "next" : undefined, icon: <Icon name="calendar" size={13} className="text-faint" /> })),
          none("No release", issue.releaseId == null),
        ],
      };
    case "type":
      return {
        multi: false,
        items: [...meta.issueTypes.map((t) => ({ id: t.id, label: t.name, checked: t.id === issue.typeId, icon: <OptionDot color={t.color} /> })), none("No type", issue.typeId == null)],
      };
    case "milestone":
      return {
        multi: false,
        items: [
          ...meta.milestones
            .filter((m) => m.state === "open" || m.id === issue.milestoneId)
            .map((m) => ({ id: m.id, label: m.title, checked: m.id === issue.milestoneId, icon: <Icon name="milestone" size={13} className="text-faint" /> })),
          none("No milestone", issue.milestoneId == null),
        ],
      };
    case "labels":
      return {
        multi: true,
        items: meta.labels
          .map((l) => ({ id: l.id, label: l.name, checked: issue.labelIds.includes(l.id), icon: <OptionDot color={l.color} /> }))
          .sort((a, b) => Number(b.checked) - Number(a.checked)),
      };
    case "assignees": {
      const mine = new Set(issue.assignees.map((a) => a.toLowerCase()));
      return {
        multi: true,
        items: meta.users
          .map((u) => ({ id: u.login, label: u.login, checked: mine.has(u.login.toLowerCase()), icon: <Avatar login={u.login} url={avatarOf(u.login)} size={16} /> }))
          .sort((a, b) => Number(b.checked) - Number(a.checked)),
      };
    }
    default:
      return { multi: false, items: [] };
  }
}

/** The value a pick means: a delta for labels and assignees, an ID or null otherwise. */
export function pickValue(issue: ClientIssue, field: EditField, id: string): unknown {
  if (field === "labels") return issue.labelIds.includes(id) ? { added: [], removed: [id] } : { added: [id], removed: [] };
  if (field === "assignees") {
    const has = issue.assignees.some((a) => a.toLowerCase() === id.toLowerCase());
    return has ? { added: [], removed: [id] } : { added: [id], removed: [] };
  }
  return id === NONE ? null : id;
}

export function FieldPicker({ issue, field, label, children }: { issue: ClientIssue; field: EditField; label: string; children: ReactNode }) {
  const { edit, isPending, disabledReason } = useIssueEdits();
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const { items, multi } = usePickItems(issue, field);
  const pending = isPending(issue.nodeId, field);

  useEffect(() => {
    const onOpen = (e: Event) => {
      const d = (e as CustomEvent<{ nodeId: string; field: EditField }>).detail;
      if (d.nodeId === issue.nodeId && d.field === field && !disabledReason) {
        anchor.current?.focus();
        setOpen(true);
      }
    };
    window.addEventListener(OPEN_PICKER_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_PICKER_EVENT, onOpen);
  }, [issue.nodeId, field, disabledReason]);

  return (
    <>
      <button
        ref={anchor}
        type="button"
        aria-label={`${label}: change`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-disabled={disabledReason ? true : undefined}
        title={disabledReason ?? `Change ${label.toLowerCase()}`}
        onClick={() => {
          if (disabledReason) return;
          setOpen(true);
        }}
        className={`-mx-1.5 flex min-h-7 min-w-0 flex-1 flex-wrap items-center gap-1.5 rounded-md px-1.5 text-left ${disabledReason ? "cursor-default" : "hover:bg-hover"}`}
      >
        {children}
        {pending && <span role="status" aria-label="Saving" className="ml-auto size-3 shrink-0 animate-spin rounded-full border-2 border-line border-t-brand" />}
      </button>
      <Popover anchor={anchor} open={open} onClose={() => setOpen(false)} width={260}>
        <PickList
          multi={multi}
          items={items}
          placeholder={`Set ${label.toLowerCase()}…`}
          onPick={(id) => {
            void edit(issue, field, pickValue(issue, field, id));
            if (!multi) setOpen(false);
          }}
        />
      </Popover>
    </>
  );
}
