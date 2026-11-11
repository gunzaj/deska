"use client";

// The elapsed time of a running AI action, ticking once a second (item 6). Shown
// next to the spinner so a slow queue or model is visible while it happens.
import { useEffect, useState } from "react";
import { elapsedSince, formatDuration } from "@/lib/ai/timing";

export function Elapsed({ since }: { since: string | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!since) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [since]);
  const ms = since ? elapsedSince(since, now) : null;
  if (ms == null) return null;
  return (
    <span className="tabular-nums text-faint" data-ai-elapsed>
      {formatDuration(ms)}
    </span>
  );
}
