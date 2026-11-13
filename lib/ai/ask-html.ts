// The answer's HTML for the page (SPEC §4.9 "Untrusted input"): the model's
// markdown goes through the existing sanitizer, and the only link that stays
// clickable is https://github.com/… — a #123 reference is one, and the page opens
// it inside Deska. The model's text is never executed.
import { renderMarkdownLite, sanitizeHtml } from "../server/issue-detail";

const ANCHOR = /<a\b[^>]*\bhref="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
/** An anchor the sanitizer kept without an href is not a link any more. */
const NO_HREF = /<a\b(?![^>]*\bhref=)[^>]*>([\s\S]*?)<\/a>/gi;

/**
 * Media the answer may not load. An image is fetched when the answer is shown,
 * with no click: text in an issue could tell the model to end its answer with
 * an image whose address carries other issues' titles to someone's server. An
 * image keeps its alt text; the rest is dropped.
 */
const IMG = /<img\b[^>]*>/gi;
const ALT = /\balt="([^"]*)"/i;
const MEDIA_BLOCK = /<\s*(video|audio|picture)\b[\s\S]*?<\s*\/\s*\1\s*>/gi;
const MEDIA_TAG = /<\s*\/?\s*(video|audio|picture|source|track)\b[^>]*>/gi;

/** Markdown → HTML with only `https://github.com/…` links clickable and no media (SPEC §4.9). */
export function answerHtml(markdown: string, repo?: string): string {
  return sanitizeHtml(renderMarkdownLite(markdown, repo))
    .replace(MEDIA_BLOCK, "")
    .replace(MEDIA_TAG, "")
    .replace(IMG, (tag: string) => ALT.exec(tag)?.[1] ?? "")
    .replace(ANCHOR, (whole: string, href: string, text: string) => (/^https:\/\/github\.com\//i.test(href) ? whole : text))
    .replace(NO_HREF, "$1");
}
