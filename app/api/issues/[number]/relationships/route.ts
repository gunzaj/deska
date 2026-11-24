import { NextResponse } from "next/server";
import { z } from "zod";
import { dbDir } from "@/db";
import { localToken } from "@/lib/github/local-token";
import { HttpError, route } from "@/lib/server/route";
import { fetchRelations, type Relations } from "@/lib/server/relationships";
import { linkRepo } from "@/lib/settings";
import { getStore } from "@/lib/store";
import { githubTarget } from "@/lib/github/url";

export const dynamic = "force-dynamic";

/**
 * An issue's "Blocked by", "Blocking" and "Relates to" issues, live from GitHub. Without a
 * token, or on demo data, both lists are empty and `cached` says why.
 */
export const GET = route(
  { auth: "viewer", params: z.object({ number: z.string().regex(/^[1-9]\d{0,9}$/) }), invalid: "bad request" },
  async ({ params }) => {
    const number = Number(params.number);
    const store = await getStore();
    const issue = [...store.issues.values()].find((i) => i.number === number);
    if (!issue) throw new HttpError(404, "not found");
    const none: Relations = { blockedBy: [], blocking: [], relatesTo: [], cached: true };
    const token = dbDir() ? localToken() : null;
    if (!token) return NextResponse.json(none);
    const target = githubTarget(issue.url, number, await linkRepo());
    try {
      const rel = await fetchRelations(token, target.repo, target.number);
      if (!rel) throw new HttpError(404, "not found");
      return NextResponse.json(rel, { headers: { "cache-control": "no-store" } });
    } catch (e) {
      if (e instanceof HttpError) throw e;
      throw new HttpError(502, "GitHub request failed");
    }
  },
);
