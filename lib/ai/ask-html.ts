// The answer's HTML for the page (SPEC §4.9 "Untrusted input"): the model's
// markdown goes through the existing sanitizer, and the only link that stays
// clickable is https://github.com/… — a #123 reference is one, and the page opens
// it inside Deska. The model's text is never executed.
import { renderMarkdownLite, sanitizeHtml } from "../server/issue-detail";

const ANCHOR = /<a\b[^>]*\bhref="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
/** An anchor the sanitizer kept without an href is not a link any more. */
const NO_HREF = /<a\b(?![^>]*\bhref=)[^>]*>([\s\S]*?)<\/a>/gi;

/** Markdown → HTML with only `https://github.com/…` links clickable (SPEC §4.9). */
export function answerHtml(markdown: string): string {
  return sanitizeHtml(renderMarkdownLite(markdown))
    .replace(ANCHOR, (whole: string, href: string, text: string) => (/^https:\/\/github\.com\//i.test(href) ? whole : text))
    .replace(NO_HREF, "$1");
}
