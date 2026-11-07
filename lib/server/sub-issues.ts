// Live children of one issue for the issue panel (§4.4): GitHub's `subIssues`,
// one page per call, so children outside the cache (old closed issues, other
// repositories) show too. Read-only: a GraphQL query, nothing else.
import { gqlClient } from "@/lib/github/client";

export const SUB_ISSUES_PAGE = 50;

export type SubIssueItem = {
  nodeId: string;
  number: number;
  title: string;
  state: "open" | "closed";
  stateReason: string | null;
  url: string;
  /** `owner/name` the child lives in (may differ from the synced repository). */
  repo: string;
  /** The child's Status option in the pinned project, when it is an item there. */
  statusOptionId: string | null;
};

export type SubIssuePage = { items: SubIssueItem[]; total: number; nextCursor: string | null };

type Node = {
  id: string;
  number: number;
  title: string;
  state: string;
  stateReason: string | null;
  url: string;
  repository: { nameWithOwner: string };
  projectItems?: { nodes: ({ project: { id: string }; fieldValues: { nodes: ({ optionId?: string; field?: { id?: string } } | null)[] } } | null)[] };
};

const QUERY = `query DeskaSubIssues($owner:String!, $name:String!, $number:Int!, $after:String) {
  repository(owner:$owner, name:$name) { issue(number:$number) {
    subIssues(first:${SUB_ISSUES_PAGE}, after:$after) {
      totalCount
      pageInfo { hasNextPage endCursor }
      nodes { id number title state stateReason url repository { nameWithOwner }
        projectItems(first:10) { nodes { project { id }
          fieldValues(first:50) { nodes { ... on ProjectV2ItemFieldSingleSelectValue { optionId field { ... on ProjectV2FieldCommon { id } } } } } } }
      }
    }
  } }
}`;

/** One page of an issue's direct children, or null when GitHub has no such issue. */
export async function fetchSubIssuesPage(
  token: string,
  repoFull: string,
  number: number,
  after: string | null,
  pinned: { projectId: string | null; statusFieldId: string | null },
): Promise<SubIssuePage | null> {
  const [owner, name] = repoFull.split("/") as [string, string];
  const res = await gqlClient(token)(QUERY, { owner, name, number, after });
  const conn = res?.repository?.issue?.subIssues as { totalCount: number; pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: (Node | null)[] } | undefined;
  if (!conn) return null;
  const items = conn.nodes.flatMap((n): SubIssueItem[] => {
    if (!n) return [];
    let statusOptionId: string | null = null;
    if (pinned.projectId && pinned.statusFieldId) {
      const item = n.projectItems?.nodes.find((p) => p?.project.id === pinned.projectId);
      statusOptionId = item?.fieldValues.nodes.find((v) => v?.field?.id === pinned.statusFieldId)?.optionId ?? null;
    }
    return [
      {
        nodeId: n.id,
        number: n.number,
        title: n.title,
        state: n.state.toLowerCase() === "open" ? "open" : "closed",
        stateReason: n.stateReason ? n.stateReason.toLowerCase() : null,
        url: n.url,
        repo: n.repository.nameWithOwner,
        statusOptionId,
      },
    ];
  });
  return { items, total: conn.totalCount, nextCursor: conn.pageInfo.hasNextPage ? conn.pageInfo.endCursor : null };
}
