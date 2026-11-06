import { NextResponse } from "next/server";
import { dbDir } from "@/db";
import { localToken } from "@/lib/github/local-token";
import { getStore } from "@/lib/store";
import type { IssueDetail } from "@/lib/client/types";
import type { ReadModel } from "@/lib/sync/read-model";
import { githubRepo } from "@/lib/config";
import { githubTarget } from "@/lib/github/url";
import { cachedDetail, cachedPrDetail, demoDetail, demoPrDetail, fetchIssueDetail } from "./issue-detail";

const KINDS = {
  issue: { label: "issue", demo: demoDetail, cached: cachedDetail },
  // GitHub's issues endpoints serve PRs too, so the live fetch is shared.
  pr: { label: "PR", demo: demoPrDetail, cached: cachedPrDetail },
} satisfies Record<string, {
  label: string;
  demo: (s: ReadModel, n: number) => Promise<IssueDetail | null>;
  cached: (s: ReadModel, n: number, reason: string | null) => Promise<IssueDetail | null>;
}>;

const found = (d: IssueDetail | null) => (d ? NextResponse.json(d) : NextResponse.json({ error: "not found" }, { status: 404 }));

/**
 * Body of the GET handlers for the issue and PR panels (read-only); the route
 * wrapper has already checked the session. Demo data gets a
 * synthetic thread; if GitHub is unreachable the cached body is returned with
 * a reason, so the panel still shows something useful.
 */
export async function detailResponse(rawNumber: string, kind: keyof typeof KINDS): Promise<NextResponse> {
  const k = KINDS[kind];
  const number = Number(rawNumber);
  if (!Number.isInteger(number) || number <= 0) return NextResponse.json({ error: `bad ${k.label} number` }, { status: 400 });

  const store = await getStore();
  if (!dbDir()) return found(await k.demo(store, number));
  const token = localToken();
  if (!token) return found(await k.cached(store, number, "GitHub is not connected — showing the cached description."));
  try {
    // Ask GitHub for the item the cache actually stored. Rebuilding the URL
    // from GITHUB_REPO + the route number opens a different repository's item
    // whenever the synced link points somewhere else.
    const stored = kind === "pr"
      ? [...store.pullRequests.values()].find((p) => p.number === number)?.url
      : [...store.issues.values()].find((i) => i.number === number)?.url;
    const target = githubTarget(stored, number, githubRepo().repoFull);
    return NextResponse.json(await fetchIssueDetail(target.number, token, target.repo), { headers: { "cache-control": "private, max-age=30" } });
  } catch (e) {
    const status = (e as { status?: number })?.status;
    return found(await k.cached(store, number, `GitHub request failed${status ? ` (HTTP ${status})` : ""} — showing the cached description.`));
  }
}
