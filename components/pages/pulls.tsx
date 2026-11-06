"use client";

import { DEFAULT_PR_STATE } from "@/lib/client/prs";
import { Icon } from "../icons";
import { PrExplorer } from "../prs/explorer";

/** All widgets PRs (SPEC §13.3), open by default. */
export function PullsPage() {
  return <PrExplorer title="Pull requests" icon={<Icon name="git" size={15} />} defaults={DEFAULT_PR_STATE} />;
}

/** Waiting on my review: requested from me directly or through my team. */
export function ReviewQueuePage() {
  return (
    <PrExplorer
      title="Review requested"
      icon={<Icon name="eye" size={15} />}
      defaults={{ ...DEFAULT_PR_STATE, filters: [{ field: "state", values: ["open"] }, { field: "requested", values: ["me"] }] }}
      empty={{ title: "Nothing waiting on your review", hint: "PRs where you or one of your teams is asked to review show up here." }}
    />
  );
}

/** My open PRs, drafts included, grouped by review decision. */
export function MyPullsPage() {
  return (
    <PrExplorer
      title="My open PRs"
      icon={<Icon name="user" size={15} />}
      defaults={{ ...DEFAULT_PR_STATE, filters: [{ field: "state", values: ["open", "draft"] }, { field: "author", values: ["me"] }], groupBy: "decision" }}
      empty={{ title: "No open PRs", hint: "Pull requests you've opened on widgets show up here." }}
    />
  );
}
