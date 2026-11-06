"use client";

// "Snoozed (n)" on the triage queues: what is parked, and a way to bring it back.
import { useMemo, useRef, useState } from "react";
import { formatDate } from "@/lib/client/format";
import { isSnoozed } from "@/lib/client/triage";
import { useAppData } from "../app/provider";
import { Icon } from "../icons";
import { Popover, btn } from "../ui/popover";
import { useSnoozes } from "./snoozes";

export function SnoozedList() {
  const { data, byNodeId } = useAppData();
  const { snoozes, unsnooze } = useSnoozes();
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const list = useMemo(
    () =>
      [...snoozes]
        .filter(([, until]) => isSnoozed(until, data.meta.today))
        .map(([nodeId, until]) => ({ issue: byNodeId.get(nodeId), nodeId, until }))
        .sort((a, b) => a.until.localeCompare(b.until)),
    [snoozes, data.meta.today, byNodeId],
  );
  if (!list.length) return null;
  return (
    <>
      <button ref={anchor} type="button" className={btn.ghost} onClick={() => setOpen((o) => !o)} aria-haspopup="dialog" data-snoozed-button>
        <Icon name="clock" size={13} />
        Snoozed ({list.length})
      </button>
      <Popover anchor={anchor} open={open} onClose={() => setOpen(false)} align="end" width={360}>
        <ul aria-label="Snoozed issues" className="max-h-80 divide-y divide-line-soft overflow-y-auto p-1 text-[12.5px]">
          {list.map(({ issue, nodeId, until }) => (
            <li key={nodeId} className="flex items-center gap-2 px-2 py-1.5">
              <span className="min-w-0 flex-1 truncate">{issue ? `#${issue.number} ${issue.title}` : nodeId}</span>
              <span className="shrink-0 text-faint">back {formatDate(until)}</span>
              <button type="button" className={btn.ghost} onClick={() => void unsnooze(nodeId)}>
                Unsnooze
              </button>
            </li>
          ))}
        </ul>
      </Popover>
    </>
  );
}
