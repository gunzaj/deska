// "Blocked by", "Blocking" and "Relates to" for the issue panel, live from GitHub. Sync does
// not cache issue dependencies, so the panel reads them when it opens, like
// the sub-issue list. Read-only: one GraphQL query, nothing else.
import { gqlClient } from "@/lib/github/client";

/** GitHub caps an issue's dependencies at 50 each way. */
export const RELATIONS_PAGE = 50;

export type RelatedIssue = {
  nodeId: string;
  number: number;
  title: string;
  state: "open" | "closed";
  stateReason: string | null;
  url: string;
  /** `owner/name` the issue lives in (may differ from the synced repository). */
  repo: string;
};

export type Relations = { blockedBy: RelatedIssue[]; blocking: RelatedIssue[]; relatesTo: RelatedIssue[]; cached: boolean };

type Node = { id: string; number: number; title: string; state: string; stateReason: string | null; url: string; repository: { nameWithOwner: string } } | null;

const FIELDS = `nodes { id number title state stateReason url repository { nameWithOwner } }`;
const QUERY = `query DeskaRelations($owner:String!, $name:String!, $number:Int!) {
  repository(owner:$owner, name:$name) { issue(number:$number) {
    blockedBy(first:${RELATIONS_PAGE}) { ${FIELDS} }
    blocking(first:${RELATIONS_PAGE}) { ${FIELDS} }
    relatesTo(first:${RELATIONS_PAGE}) { ${FIELDS} }
  } }
}`;

function toItem(n: Node): RelatedIssue[] {
  if (!n) return [];
  return [
    {
      nodeId: n.id,
      number: n.number,
      title: n.title,
      state: n.state === "OPEN" ? "open" : "closed",
      stateReason: n.stateReason ? n.stateReason.toLowerCase() : null,
      url: n.url,
      repo: n.repository.nameWithOwner,
    },
  ];
}

/** The issue's blockers, the issues it blocks and its related issues, or null when GitHub has no such issue. */
export async function fetchRelations(token: string, repoFull: string, number: number): Promise<Relations | null> {
  const [owner, name] = repoFull.split("/") as [string, string];
  const res = await gqlClient(token)(QUERY, { owner, name, number });
  const issue = res?.repository?.issue as { blockedBy?: { nodes: Node[] }; blocking?: { nodes: Node[] }; relatesTo?: { nodes: Node[] } } | null | undefined;
  if (!issue) return null;
  return {
    blockedBy: (issue.blockedBy?.nodes ?? []).flatMap(toItem),
    blocking: (issue.blocking?.nodes ?? []).flatMap(toItem),
    relatesTo: (issue.relatesTo?.nodes ?? []).flatMap(toItem),
    cached: false,
  };
}
