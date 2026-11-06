"use client";

import { useEffect } from "react";
import { Icon } from "../icons";
import { useWatchlist, type WatchKind } from "./store";

/** Watch / stop watching an issue or a saved view (F6). */
export function WatchStar({ kind, id, className = "" }: { kind: WatchKind; id: string; className?: string }) {
  const { isWatching, toggle } = useWatchlist();
  const on = isWatching(kind, id);
  return (
    <button
      type="button"
      onClick={() => void toggle(kind, id)}
      aria-pressed={on}
      aria-label={on ? "Stop watching" : "Watch"}
      title={on ? "Watching: see what changes on the Watching page. Click to stop." : "Watch this to see what changes"}
      data-watch-star
      className={`grid size-7 place-items-center rounded-md hover:bg-hover ${on ? "text-warning" : "text-faint hover:text-fg"} ${className}`}
    >
      <Icon name="star" size={15} className={on ? "fill-current" : ""} />
    </button>
  );
}

/** Opening a watched item counts as looking at it: what changed before is no longer news. */
export function SeenOnOpen({ kind, id }: { kind: WatchKind; id: string }) {
  const { markSeen, loaded, isWatching } = useWatchlist();
  const watching = isWatching(kind, id);
  useEffect(() => {
    if (loaded && watching) void markSeen(kind, id);
    // Once per open, and when the watch is first known.
  }, [kind, id, loaded, watching, markSeen]);
  return null;
}
