"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { withDefaultScope } from "@/lib/client/team-scope";
import { runExplorer } from "@/lib/client/explorer";
import { isSnoozed, withoutSnoozed } from "@/lib/client/triage";
import { useAppData } from "../app/provider";
import { triageTabs } from "../triage/queues";
import { useDefaultScope } from "../app/team-scope";
import { Explorer } from "../explorer/explorer";
import { Icon } from "../icons";
import { useSnoozes } from "../triage/snoozes";
import { SnoozedList } from "../triage/snoozed-list";
import { btn } from "../ui/popover";

export function TriagePage() {
  const { data } = useAppData();
  const params = useSearchParams();
  const TRIAGE_TABS = useMemo(() => triageTabs(data.meta), [data.meta]);
  const tab = TRIAGE_TABS.find((t) => t.id === params.get("tab")) ?? TRIAGE_TABS[0]!;
  const { snoozes } = useSnoozes();
  const { scope } = useDefaultScope();
  const counts = useMemo(
    () => Object.fromEntries(TRIAGE_TABS.map((t) => [t.id, withoutSnoozed(runExplorer(data.issues, withDefaultScope(t.base, [], scope), [], data.meta), snoozes, data.meta.today).length])),
    [data, snoozes, scope, TRIAGE_TABS],
  );
  const hidden = useMemo(() => new Set([...snoozes].filter(([, until]) => isSnoozed(until, data.meta.today)).map(([id]) => id)), [snoozes, data.meta.today]);

  return (
    <Explorer
      key={tab.id}
      title={
        <span className="flex items-center gap-3">
          Triage
          <nav aria-label="Triage queues" className="flex items-center gap-0.5 overflow-x-auto text-[12.5px] font-medium">
            {TRIAGE_TABS.map((t) => (
              <Link
                key={t.id}
                href={`/triage?tab=${t.id}`}
                title={t.hint}
                aria-current={t.id === tab.id ? "page" : undefined}
                className={`flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 ${t.id === tab.id ? "bg-active text-fg" : "text-muted hover:bg-hover hover:text-fg"}`}
              >
                {t.label}
                <span className="tabular-nums text-faint">{counts[t.id]}</span>
              </Link>
            ))}
          </nav>
        </span>
      }
      icon={<Icon name="inbox" size={15} />}
      headerExtra={
        <>
          <SnoozedList />
          <Link href={`/triage/run?tab=${tab.id}`} className={btn.primary} data-start-triage>
            <Icon name="play" size={13} />
            Start triage
          </Link>
        </>
      }
      hideIds={hidden}
      base={tab.base}
      defaults={tab.defaults}
      emptyTitle="Inbox zero"
      emptyHint={`${tab.hint} Nothing here right now.`}
    />
  );
}
