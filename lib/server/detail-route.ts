import { NextResponse } from "next/server";
import { dbDir } from "@/db";
import { localToken } from "@/lib/github/local-token";
import { getStore } from "@/lib/store";
import type { IssueDetail } from "@/lib/client/types";
import { githubRepo } from "@/lib/config";
import { githubTarget } from "@/lib/github/url";
import { cachedDetail, demoDetail, fetchIssueDetail } from "./issue-detail";

const found = (d: IssueDetail | null) => (d ? NextResponse.json(d) : NextResponse.json({ error: "not found" }, { status: 404 }));

/**
 * Body of the GET handler for the issue panel (read-only); the route
 * wrapper has already checked the session. Demo data gets a
 * synthetic thread; if GitHub is unreachable the cached body is returned with
 * a reason, so the panel still shows something useful.
 */
export async function detailResponse(rawNumber: string): Promise<NextResponse> {
  const number = Number(rawNumber);
  if (!Number.isInteger(number) || number <= 0) return NextResponse.json({ error: "bad issue number" }, { status: 400 });

  const store = await getStore();
  if (!dbDir()) return found(await demoDetail(store, number));
  const token = localToken();
  if (!token) return found(await cachedDetail(store, number, "GitHub is not connected — showing the cached description."));
  try {
    // Ask GitHub for the item the cache actually stored. Rebuilding the URL
    // from GITHUB_REPO + the route number opens a different repository's item
    // whenever the synced link points somewhere else.
    const stored = [...store.issues.values()].find((i) => i.number === number)?.url;
    const target = githubTarget(stored, number, githubRepo().repoFull);
    return NextResponse.json(await fetchIssueDetail(target.number, token, target.repo), { headers: { "cache-control": "private, max-age=30" } });
  } catch (e) {
    const status = (e as { status?: number })?.status;
    return found(await cachedDetail(store, number, `GitHub request failed${status ? ` (HTTP ${status})` : ""} — showing the cached description.`));
  }
}
