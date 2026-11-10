import { NextResponse } from "next/server";
import { z } from "zod";
import { dbDir } from "@/db";
import { localToken } from "@/lib/github/local-token";
import { HttpError, route } from "@/lib/server/route";
import { fetchSubIssuesPage, type SubIssueItem } from "@/lib/server/sub-issues";
import { currentTarget, linkRepo } from "@/lib/settings";
import { getStore } from "@/lib/store";
import { githubTarget } from "@/lib/github/url";

export const dynamic = "force-dynamic";

/**
 * One page of an issue's direct children, live from GitHub (§4.4). Without a
 * token, or on demo data, the cached children come back as a single page: the
 * panel then says how many of GitHub's total it could show.
 */
export const GET = route(
  {
    auth: "viewer",
    params: z.object({ number: z.string().regex(/^[1-9]\d{0,9}$/) }),
    query: z.object({ after: z.string().max(200).optional() }),
    invalid: "bad request",
  },
  async ({ params, query }) => {
    const number = Number(params.number);
    const store = await getStore();
    const parent = [...store.issues.values()].find((i) => i.number === number);
    if (!parent) throw new HttpError(404, "not found");
    const repo = await linkRepo();
    const cached = (): { items: SubIssueItem[]; total: number; nextCursor: null; cached: true } => {
      const items = [...store.issues.values()]
        .filter((i) => i.parentNodeId === parent.nodeId)
        .sort((a, b) => a.number - b.number)
        .map((i) => ({
          nodeId: i.nodeId,
          number: i.number,
          title: i.title,
          state: (i.state === "open" ? "open" : "closed") as "open" | "closed",
          stateReason: i.stateReason,
          url: i.url,
          repo,
          statusOptionId: store.itemForIssue(i.nodeId)?.statusOpt ?? null,
        }));
      return { items, total: parent.subTotal ?? items.length, nextCursor: null, cached: true };
    };
    const token = dbDir() ? localToken() : null;
    if (!token) return NextResponse.json(cached());
    const target = githubTarget(parent.url, number, repo);
    const settings = await currentTarget();
    try {
      const page = await fetchSubIssuesPage(token, target.repo, target.number, query.after ?? null, {
        projectId: settings?.projectId ?? null,
        statusFieldId: store.projectFieldMap().status?.id ?? null,
      });
      if (!page) throw new HttpError(404, "not found");
      return NextResponse.json(page, { headers: { "cache-control": "private, max-age=30" } });
    } catch (e) {
      if (e instanceof HttpError) throw e;
      // GitHub unreachable or refusing: the cached children are better than nothing on the first page.
      if (!query.after) return NextResponse.json(cached());
      throw new HttpError(502, "GitHub request failed");
    }
  },
);
