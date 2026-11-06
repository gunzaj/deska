import { headers } from "next/headers";
import { auth } from "./auth";
import { e2eBypassActive, e2eDefaultLogin } from "./e2e-bypass";

/**
 * The signed-in user's GitHub login. Falls back to the E2E bypass header in
 * tests; returns null when unauthenticated or denied (middleware normally
 * redirects first — this keeps routes safe if a path ever slips past it).
 */
export async function getViewerLogin(): Promise<string | null> {
  const session = (await auth()) as { login?: string | null; isAllowed?: boolean } | null;
  if (session?.login) return session.isAllowed ? session.login : null;
  if (e2eBypassActive()) {
    return (await headers()).get("x-e2e-login") ?? e2eDefaultLogin();
  }
  return null;
}
