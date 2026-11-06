import { headers } from "next/headers";
import { localLogin } from "./connection";
import { desktopGuard } from "./desktop/guard";
import { e2eBypassActive, e2eDefaultLogin } from "./e2e-bypass";

/**
 * The app's one local user (SPEC §2.3): the owner of the stored GitHub token.
 * Null without a token, and outside the desktop app, except in tests and the
 * dev preview, where the test-only identity header (or its default) names a
 * fictional user. Pages without a viewer go to onboarding; API routes answer
 * 401.
 */
export async function getViewerLogin(): Promise<string | null> {
  // Desktop: the middleware admitted only the app's own window.
  if (desktopGuard()) return localLogin();
  if (e2eBypassActive()) {
    return (await headers()).get("x-e2e-login") ?? e2eDefaultLogin();
  }
  return null;
}
