// Where a URL may go from the app window (SPEC §2.2): the app's own origin
// stays in the window, https://github.com/ opens in the default browser,
// meeting links on the calendar allowlist (CALENDAR-SPEC §6, C-G) open there
// too, and everything else is blocked.
//
// The allowlist is repeated in lib/calendar/join.ts (the page decides whether
// to draw a "Join" button; main is what enforces the rule). This file cannot
// import lib/, and a test fails if the two lists ever differ.

export type NavDecision = "app" | "github" | "meeting" | "blocked";

/** Exact hosts, and hosts under a suffix ("*.zoom.us" = any subdomain). */
export const MEETING_HOSTS = ["meet.google.com", "teams.microsoft.com", "teams.live.com"];
export const MEETING_HOST_SUFFIXES = ["zoom.us", "webex.com"];

/** A https meeting link on the fixed allowlist (CALENDAR-SPEC §6). */
export function meetingUrl(value: string): boolean {
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" || u.username || u.password || (u.port !== "" && u.port !== "443")) return false;
  const host = u.hostname.toLowerCase();
  return MEETING_HOSTS.includes(host) || MEETING_HOST_SUFFIXES.some((s) => host === s || host.endsWith(`.${s}`));
}

export function classifyUrl(url: string, appOrigin: string): NavDecision {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return "blocked";
  }
  if (u.origin === appOrigin) return "app";
  if (u.protocol === "https:" && u.hostname === "github.com" && u.port === "" && !u.username && !u.password) return "github";
  if (meetingUrl(url)) return "meeting";
  return "blocked";
}

/** Whether the window may open this URL in the default browser at all. */
export function opensExternally(url: string, appOrigin: string): boolean {
  const where = classifyUrl(url, appOrigin);
  return where === "github" || where === "meeting";
}

/** Hosts the window may load images and videos from: GitHub avatars and issue attachments. */
const GITHUB_ASSET_HOST = /^(github\.com|[a-z0-9-]+\.githubusercontent\.com)$/;

/**
 * Whether the window may make a request at all. Its own origin, in-page
 * schemes and DevTools; GitHub images and videos. Nothing else reaches the
 * network.
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
  return (resourceType === "image" || resourceType === "media") && u.protocol === "https:" && GITHUB_ASSET_HOST.test(u.hostname);
}
