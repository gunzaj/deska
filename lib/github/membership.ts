import { githubOrg } from "../config";
/**
 * Is the token's user an active member of the org? (SPEC §14) Uses the user's
 * own token with `read:org`. Returns null when GitHub can't answer right now,
 * so a transient failure neither grants nor revokes access.
 */
export async function checkOrgMembership(accessToken: string, org = githubOrg()): Promise<boolean | null> {
  try {
    const res = await fetch(`https://api.github.com/user/memberships/orgs/${encodeURIComponent(org)}`, {
      headers: { authorization: `Bearer ${accessToken}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" },
      cache: "no-store",
    });
    // A rate-limited 403 says nothing about membership. Reading it as "not a
    // member" ended a known member's session whenever the token hit a limit.
    if (res.status === 403 && (res.headers.get("x-ratelimit-remaining") === "0" || res.headers.has("retry-after"))) return null;
    if (res.status === 404 || res.status === 403 || res.status === 401) return false;
    if (!res.ok) return null;
    const body = (await res.json()) as { state?: string };
    return body.state === "active";
  } catch {
    return null;
  }
}
