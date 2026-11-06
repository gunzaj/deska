"use client";

// "Possible duplicates" in the issue panel (IMPROVEMENTS F7): up to three
// issues with a similar title, as links. Read-only; nothing is merged or closed.
import { useEffect, useState } from "react";
import type { DuplicateCandidate } from "@/lib/client/similarity";
import { useOpenIssue } from "../app/open-issue";
import { Icon } from "../icons";

const cache = new Map<number, DuplicateCandidate[]>();

export function PossibleDuplicates({ number }: { number: number }) {
  const open = useOpenIssue();
  const [list, setList] = useState<DuplicateCandidate[] | null>(cache.get(number) ?? null);
  useEffect(() => {
    const hit = cache.get(number);
    setList(hit ?? null);
    if (hit) return;
    const ctrl = new AbortController();
    void fetch(`/api/issues/${number}/duplicates`, { signal: ctrl.signal })
      .then(async (res) => (res.ok ? ((await res.json()) as { duplicates: DuplicateCandidate[] }).duplicates : []))
      .catch(() => [] as DuplicateCandidate[])
      .then((d) => {
        if (ctrl.signal.aborted) return;
        cache.set(number, d);
        setList(d);
      });
    return () => ctrl.abort();
  }, [number]);

  // Nothing to say, or not known yet: no section at all.
  if (!list?.length) return null;
  return (
    <section aria-label="Possible duplicates" data-duplicates>
      <h3 className="mb-1.5 text-[12.5px] font-semibold text-muted">Possible duplicates</h3>
      <ul className="space-y-1">
        {list.map((d) => (
          <li key={d.number} className="flex items-center gap-2 text-[13px]">
            <Icon name={d.state === "open" ? "circleDot" : "circleCheck"} size={13} className={d.state === "open" ? "text-faint" : "text-violet"} />
            <button type="button" onClick={() => open(d.number)} className="min-w-0 truncate text-left hover:underline">
              <span className="text-faint">#{d.number}</span> {d.title}
            </button>
            <span className="shrink-0 text-[11.5px] text-faint">{d.state === "closed" ? "closed · " : ""}{Math.round(d.similarity * 100)}% alike</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
