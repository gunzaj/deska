"use client";

import { checksKey, CHECKS_LABEL, DECISION_LABEL, prStateKey, STATE_LABEL } from "@/lib/client/prs";
import type { ClientPr } from "@/lib/client/types";

// Visual atoms for PRs. Colours follow GitHub's: open green, draft grey,
// merged violet, closed red.

const STATE_COLOR = { open: "#1f883d", draft: "var(--fg-faint)", merged: "#8250df", closed: "var(--prio-1)" } as const;

export function PrStateIcon({ pr, size = 14 }: { pr: Pick<ClientPr, "state" | "isDraft">; size?: number }) {
  const k = prStateKey(pr);
  const c = STATE_COLOR[k];
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} aria-label={STATE_LABEL[k]} role="img" className="shrink-0" fill="none" stroke={c} strokeWidth="1.5" strokeLinecap="round">
      <circle cx="4" cy="3.5" r="1.6" />
      <circle cx="4" cy="12.5" r="1.6" />
      <path d="M4 5.1v5.8" />
      {k === "merged" ? (
        <>
          <circle cx="12" cy="12.5" r="1.6" />
          <path d="M4 5.5c0 3 3 4.5 6.4 6.6" />
        </>
      ) : k === "closed" ? (
        <path d="m10.5 2.5 3 3m0-3-3 3M12 8v2.9" />
      ) : (
        <>
          <circle cx="12" cy="12.5" r="1.6" strokeDasharray={k === "draft" ? "2 1.6" : undefined} />
          <path d="M12 10.9V6a2 2 0 0 0-2-2H7.5m1.5-1.5L7.5 4 9 5.5" />
        </>
      )}
    </svg>
  );
}

const CHECK_COLOR: Record<string, string> = { SUCCESS: "#1f883d", FAILURE: "var(--prio-1)", PENDING: "var(--prio-2)", none: "var(--fg-faint)" };

export function ChecksIcon({ state, size = 13 }: { state: string | null; size?: number }) {
  const k = checksKey(state);
  if (k === "none") return null;
  return (
    <span title={CHECKS_LABEL[k]} role="img" aria-label={CHECKS_LABEL[k]} className="inline-grid">
      <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke={CHECK_COLOR[k]} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        {k === "SUCCESS" ? <path d="m3.5 8.5 3 3 6-7" /> : k === "FAILURE" ? <path d="m4 4 8 8m0-8-8 8" /> : <circle cx="8" cy="8" r="3.2" fill={CHECK_COLOR[k]} stroke="none" />}
      </svg>
    </span>
  );
}

const DECISION_STYLE: Record<string, string> = {
  APPROVED: "text-[#1f883d] bg-[#1f883d1a]",
  CHANGES_REQUESTED: "text-critical bg-critical-soft",
  REVIEW_REQUIRED: "text-muted bg-hover",
};

export function DecisionBadge({ decision }: { decision: string | null }) {
  if (!decision) return null;
  return <span className={`inline-flex h-5 items-center rounded px-1.5 text-[11px] font-semibold ${DECISION_STYLE[decision] ?? "text-muted bg-hover"}`}>{DECISION_LABEL[decision] ?? decision}</span>;
}

/** Review state of one reviewer, from latest reviews and pending requests. */
export function reviewerStates(pr: ClientPr): { who: string; team: boolean; state: string }[] {
  const out = pr.reviews.map((r) => ({ who: r.author, team: false, state: r.state }));
  for (const r of pr.reviewRequests) {
    if (!out.some((o) => !o.team === (r.kind === "user") && o.who.toLowerCase() === r.reviewer.toLowerCase())) {
      out.push({ who: r.reviewer, team: r.kind === "team", state: "REQUESTED" });
    }
  }
  return out;
}

export const REVIEW_STATE_LABEL: Record<string, string> = {
  APPROVED: "Approved",
  CHANGES_REQUESTED: "Requested changes",
  COMMENTED: "Commented",
  DISMISSED: "Dismissed",
  PENDING: "Pending",
  REQUESTED: "Review requested",
};
