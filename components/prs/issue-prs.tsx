"use client";

import { DecisionBadge, PrStateIcon } from "./bits";
import { openPr } from "./open-pr";
import { usePrs } from "./store";

/** PRs that close this issue (closingIssuesReferences), on the issue panel. */
export function LinkedPrs({ nodeId }: { nodeId: string }) {
  const { closing } = usePrs();
  const prs = closing(nodeId);
  if (!prs.length) return null;
  return (
    <section aria-label="Linked PRs">
      <h3 className="mb-2 text-[12.5px] font-semibold text-muted">Linked PRs</h3>
      <ul className="divide-y divide-line-soft rounded-xl border border-line">
        {prs.map((p) => (
          <li key={p.nodeId}>
            <button type="button" onClick={() => openPr(p.number)} className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-hover">
              <PrStateIcon pr={p} />
              <span className="font-mono text-[12px] text-faint">#{p.number}</span>
              <span className="min-w-0 flex-1 truncate text-[13px]">{p.title}</span>
              <DecisionBadge decision={p.state === "open" ? p.reviewDecision : null} />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
