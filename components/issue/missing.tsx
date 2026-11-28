"use client";

import { useEffect, useState } from "react";
import type { IssueLookup } from "@/lib/server/lookup";
import { useAppData } from "../app/provider";
import { Icon } from "../icons";
import { EmptyHint } from "../props";
import { btn } from "../ui/popover";

type Missing = Extract<IssueLookup, { found: false }>["reason"];

const HINT: Record<Missing, string> = {
  "not-found": "GitHub has no issue with this number in this repository. It may be a pull request.",
  "sample-data": "The sample data has no issue with this number.",
  "not-connected": "GitHub is not connected, so Deska can't look it up.",
  "rate-limited": "GitHub's rate limit is used up for now. Try again in a few minutes.",
  failed: "Deska couldn't reach GitHub to look it up. Try again in a moment.",
};

/**
 * The panel for an issue the cache doesn't hold (one closed before the import
 * window, usually): ask the server to fetch it from GitHub. When it arrives
 * the data refresh puts it in the cache and the caller shows the issue.
 */
export function MissingIssue({ number, onClose }: { number: number; onClose?: () => void }) {
  const { refresh } = useAppData();
  const [reason, setReason] = useState<Missing | null>(null);
  useEffect(() => {
    let live = true;
    setReason(null);
    void (async () => {
      const res = await fetch(`/api/issues/${number}/lookup`, {
        method: "POST",
      }).catch(() => null);
      const out = res?.ok ? ((await res.json().catch(() => null)) as IssueLookup | null) : null;
      if (out?.found) await refresh();
      // Still mounted after a successful refresh: the row didn't arrive.
      if (live) setReason(out && !out.found ? out.reason : "failed");
    })();
    return () => {
      live = false;
    };
  }, [number, refresh]);

  return (
    <div className="flex h-full flex-col" data-issue-lookup={reason ?? "looking"}>
      {onClose && (
        <div className="flex h-12 items-center justify-end border-b border-line px-3">
          <button type="button" onClick={onClose} aria-label="Close" className={btn.icon}>
            <Icon name="x" size={16} />
          </button>
        </div>
      )}
      {reason ? (
        <EmptyHint icon="search" title={`Issue #${number} wasn't found`} hint={HINT[reason]} />
      ) : (
        <div role="status">
          <EmptyHint icon="clock" title={`Looking up #${number} on GitHub…`} hint="It isn't in Deska yet. Issues closed long ago are fetched when you ask for them." />
        </div>
      )}
    </div>
  );
}
