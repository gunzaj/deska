// A video in an issue's HTML that outlived its URL. In a private repository
// GitHub renders attachments as signed URLs that expire after about five
// minutes. A browser reads a video in pieces as it plays, so a longer video
// (or one started late) asks for its next piece with an expired URL, gets a
// 4xx and stops for good. The cure is a new rendering of the same HTML, which
// carries a newly signed URL for the same file.

/** What stays the same when GitHub signs the same file again: the URL without its query. */
export function mediaKey(src: string): string | null {
  try {
    const u = new URL(src);
    return u.origin + u.pathname;
  } catch {
    return null;
  }
}

/**
 * The URL to retry a failed video with, out of a new rendering's video URLs:
 * the same file under a new signature, else the video at the same position
 * when the HTML still has as many videos. Null when there is nothing new to
 * try (an unsigned URL comes back unchanged: the failure was something else).
 */
export function freshMediaSrc(stale: string, index: number, before: number, fresh: readonly string[]): string | null {
  const key = mediaKey(stale);
  const same = key ? fresh.find((s) => mediaKey(s) === key) : undefined;
  const next = same ?? (fresh.length === before ? fresh[index] : undefined);
  return next && next !== stale ? next : null;
}

/** Wait this long before renewing the same video again: a file that cannot play must not loop. */
export const MEDIA_RETRY_GAP_MS = 30_000;
