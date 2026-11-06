// Content Security Policy for pages (v5 4.10). Edge-safe: no imports.

/**
 * A per-request CSP with a nonce (v5 4.10). The sanitizer in front of the
 * GitHub-rendered HTML is a regex, so this is the backstop: a script that gets
 * through still does not run, because only scripts Next.js (or the theme
 * snippet) stamped with this request's nonce may. `style-src` keeps
 * 'unsafe-inline' for React style attributes; `img-src` allows https because
 * issue and comment HTML embeds GitHub-hosted images (only GitHub's hosts in
 * the desktop app).
 */
export function contentSecurityPolicy(nonce: string, dev = process.env.NODE_ENV !== "production", desktop = false): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    // The desktop app loads nothing from the network but GitHub (SPEC §2.2):
    // images in issue bodies and avatars come from GitHub's hosts.
    desktop ? "img-src 'self' data: https://github.com https://*.githubusercontent.com" : "img-src 'self' data: https:",
    "font-src 'self' data:",
    `connect-src 'self'${dev ? " ws: wss:" : ""}`,
    "object-src 'none'",
    "base-uri 'self'",
    // Sign-in posts to our own route, which answers with a redirect to GitHub.
    "form-action 'self' https://github.com",
    "frame-ancestors 'none'",
  ].join("; ");
}
