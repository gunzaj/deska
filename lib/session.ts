import { headers } from "next/headers";
import { localLogin } from "./connection";
import { desktopGuard } from "./desktop/guard";
import { e2eBypassActive, e2eDefaultLogin } from "./e2e-bypass";
import { readTasksOnly } from "./settings";
import { LOCAL_LOGIN } from "./tasks-only";

/**
 * The app's one local user (SPEC §2.3): the owner of the stored GitHub token.
 * Null without a token, and outside the desktop app, except in tests and the
 * dev preview, where the test-only identity header (or its default) names a
 * fictional user. Pages without a viewer go to onboarding; API routes answer
 * 401.
 */
export async function getViewerLogin(): Promise<string | null> {
  // Desktop: the middleware admitted only the app's own window.
  if (desktopGuard()) {
    const login = await localLogin();
    if (login) return login;
    // No GitHub token, but the user chose to use tasks only: a local stand-in.
    return (await readTasksOnly().catch(() => false)) ? LOCAL_LOGIN : null;
  }
  if (e2eBypassActive()) {
    return (await headers()).get("x-e2e-login") ?? e2eDefaultLogin();
  }
  return null;
}
