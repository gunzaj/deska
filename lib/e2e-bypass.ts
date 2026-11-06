/**
 * True only when the test-only identity is active (e2e and the dev preview on
 * sample data, outside the desktop app).
 *
 * This flag lets whoever the `x-e2e-login` header names use the app without a
 * GitHub token, so it must never be honoured in production. Requiring an
 * explicit opt-in flag in addition to the env var means a stray
 * E2E_AUTH_BYPASS=1 in a production build still cannot open the app.
 */
export function e2eBypassActive(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  return process.env.E2E_AUTH_BYPASS === "1" && process.env.E2E_BYPASS_ACK === "i-understand";
}
/**
 * Login to assume when the bypass is active and no `x-e2e-login` header is
 * sent — lets a local browser preview the app on demo data. Same guards as
 * the bypass itself, so it can never apply in production.
 */
export function e2eDefaultLogin(): string | null {
  if (!e2eBypassActive()) return null;
  const l = process.env.E2E_DEFAULT_LOGIN?.trim();
  return l ? l : null;
}
