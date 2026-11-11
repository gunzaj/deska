"use client";

// The Risk section of a Release page (IMPROVEMENTS F2).
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { encodeState } from "@/lib/client/explorer";
import { PRESETS } from "@/lib/client/presets";
import { releaseRisk } from "@/lib/client/risk";
import { isUnauthorized } from "@/lib/client/session";
import type { ClientIssue, ClientRelease } from "@/lib/client/types";
import type { Filter } from "@/lib/views/view";
import { useOpenIssue } from "../app/open-issue";
import { useAppData } from "../app/provider";
import { Icon } from "../icons";

/** Issues F0 saw set to this Release on or after its start. A failed load just means none are shown. */
export function useScopeAdded(release: ClientRelease): { ids: string[]; loaded: boolean } {
  const [state, setState] = useState<{ key: string; ids: string[] } | null>(null);
  const key = `${release.id}:${release.startDate}`;
  useEffect(() => {
    let live = true;
    void fetch(`/api/releases/${encodeURIComponent(release.id)}/scope-added?since=${release.startDate}`)
      .then(async (res) => {
        if (isUnauthorized(res) || !res.ok) return [] as string[];
        return ((await res.json()) as { nodeIds: string[] }).nodeIds;
      })
      .catch(() => [] as string[])
      .then((ids) => live && setState({ key, ids }));
    return () => {
      live = false;
    };
  }, [release.id, release.startDate, key]);
  return state?.key === key ? { ids: state.ids, loaded: true } : { ids: [], loaded: false };
}

const explorer = (filters: Parameters<typeof encodeState>[0]["filters"]) => `/issues?s=${encodeState({ ...PRESETS.all, filters })}`;

function Group({ id, title, hint, issues, href }: { id: string; title: string; hint: string; issues: ClientIssue[]; href: string }) {
  const open = useOpenIssue();
  return (
    <section aria-label={title} data-risk={id} className="min-w-0">
      <div className="flex items-baseline gap-2">
        <h3 className="text-[12.5px] font-semibold">
          {title} <span className="tabular-nums text-faint" data-risk-count>{issues.length}</span>
        </h3>
        {issues.length > 0 && (
          <Link href={href} className="text-[11.5px] text-brand-text hover:underline">
            View in explorer
          </Link>
        )}
      </div>
      <p className="text-[11.5px] text-faint">{hint}</p>
      {issues.length > 0 && (
        <ul className="mt-1 space-y-0.5">
          {issues.slice(0, 6).map((i) => (
            <li key={i.nodeId} className="truncate text-[12.5px]">
              <button type="button" onClick={() => open(i.number)} className="text-left hover:underline">
                <span className="text-faint">#{i.number}</span> {i.title}
              </button>
            </li>
          ))}
          {issues.length > 6 && <li className="text-[11.5px] text-faint">and {issues.length - 6} more</li>}
        </ul>
      )}
    </section>
  );
}

export function ReleaseRisk({ release, issues, filters = [] }: { release: ClientRelease; issues: ClientIssue[]; filters?: Filter[] }) {
  const { data } = useAppData();
  const scope = useScopeAdded(release);
  const risk = useMemo(
    () =>
      releaseRisk({
        issues,
        release,
        meta: data.meta,
        scopeAddedIds: scope.ids,
      }),
    [issues, data.meta, release, scope.ids],
  );
  const base = [...filters, { field: "release" as const, op: "in" as const, values: [release.id] }, { field: "state" as const, op: "in" as const, values: ["open" as const] }];
  const top = risk.topPriorityId ? [{ field: "priority" as const, op: "in" as const, values: [risk.topPriorityId] }] : [];
  const count = risk.noOwner.length + risk.scopeAdded.length;

  return (
    <details open={count > 0} className="shrink-0 border-b border-line px-4 py-2" data-release-risk>
      <summary className="flex cursor-pointer select-none items-center gap-2 text-[12.5px] font-semibold">
        <Icon name="flag" size={13} className={count ? "text-warning" : "text-faint"} />
        Risk
        <span className="font-normal text-faint">
          {count === 0 ? "nothing flagged" : `${count} flagged`}
        </span>
      </summary>
      <div className="mt-2 grid gap-4 pb-1 md:grid-cols-2">
        <Group
          id="no-owner"
          title="Top priority, no assignee"
          hint="Open issues with the highest Priority and nobody on them."
          issues={risk.noOwner}
          href={explorer([...base, ...top, { field: "assignee", op: "empty" }])}
        />
        <Group
          id="scope-added"
          title="Added after the start"
          hint={scope.loaded ? "Issues put into this Release once it had started." : "Loading…"}
          issues={risk.scopeAdded}
          href={explorer([...filters, { field: "release", op: "in", values: [release.id] }])}
        />
      </div>
    </details>
  );
}
