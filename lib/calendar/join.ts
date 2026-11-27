// The "Join" allowlist (CALENDAR-SPEC §6, C-G): the only links in a meeting
// that Deska opens externally. https only, hosts matched exactly. Main keeps
// its own copy in desktop/navigation.ts (it cannot import lib/), the helper
// has a third (it picks the link out of an event's notes), and a test fails if
// the lists ever differ.
export const MEETING_HOSTS = ["meet.google.com", "teams.microsoft.com", "teams.live.com"] as const;
export const MEETING_HOST_SUFFIXES = ["zoom.us", "webex.com"] as const;

/** A https URL on the meeting allowlist. */
export function isMeetingUrl(value: string): boolean {
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" || u.username || u.password || (u.port !== "" && u.port !== "443")) return false;
  const host = u.hostname.toLowerCase();
  if ((MEETING_HOSTS as readonly string[]).includes(host)) return true;
  return MEETING_HOST_SUFFIXES.some((s) => host === s || host.endsWith(`.${s}`));
}

const URL_IN_TEXT = /https:\/\/[^\s<>"'`]+/g;

/**
 * The event's URL when it is a meeting link, else the first allowlisted link in
 * its location, else the one the helper found in its notes (§6; Google Meet and
 * Teams invitations carry theirs only there). Any other URL is shown as text
 * and never becomes a button.
 */
export function meetingJoinUrl(event: { url: string | null; location: string | null; meetingUrl?: string | null }): string | null {
  if (event.url && isMeetingUrl(event.url)) return event.url;
  for (const raw of event.location?.match(URL_IN_TEXT) ?? []) {
    // A link at the end of a sentence carries its punctuation.
    const candidate = raw.replace(/[),.;!?\]]+$/, "");
    if (isMeetingUrl(candidate)) return candidate;
  }
  if (event.meetingUrl && isMeetingUrl(event.meetingUrl)) return event.meetingUrl;
  return null;
}
