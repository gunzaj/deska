// Where a URL may go from the app window (SPEC §2.2): the app's own origin
// stays in the window, https://github.com/ opens in the default browser, and
// everything else is blocked.

export type NavDecision = "app" | "github" | "blocked";

export function classifyUrl(url: string, appOrigin: string): NavDecision {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return "blocked";
  }
  if (u.origin === appOrigin) return "app";
  if (u.protocol === "https:" && u.hostname === "github.com" && u.port === "" && !u.username && !u.password) return "github";
  return "blocked";
}

/** Hosts the window may load images from: GitHub avatars and issue attachments. */
const GITHUB_IMAGE_HOST = /^(github\.com|[a-z0-9-]+\.githubusercontent\.com)$/;

/**
 * Whether the window may make a request at all. Its own origin, in-page
 * schemes and DevTools; GitHub images. Nothing else reaches the network.
 */
export function requestAllowed(url: string, resourceType: string, appOrigin: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.origin === appOrigin) return true;
  if (u.protocol === "data:" || u.protocol === "blob:" || u.protocol === "devtools:") return true;
  return resourceType === "image" && u.protocol === "https:" && GITHUB_IMAGE_HOST.test(u.hostname);
}
