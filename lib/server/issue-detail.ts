// Issue body + comment thread for the issue panel. Read-only: GET requests
// only, with the viewer's own token. GitHub renders the markdown for us
// (`body_html`), so the panel matches github.com exactly.
import { restClient } from "@/lib/github/client";
import { displayRepo } from "@/lib/config";
import { linkRepo } from "@/lib/settings";
import { parseGitHubItemUrl } from "@/lib/github/url";
import type { IssueComment, IssueDetail } from "@/lib/client/types";
import type { ReadModel } from "@/lib/sync/read-model";
import { cachedBody, removedItem, removedNote } from "./bodies";

const TTL_MS = 60_000;
const cache = new Map<string, { at: number; detail: IssueDetail }>();

/** Drop expired entries so a long-running server does not keep every issue it ever opened. */
function pruneCache(now: number): void {
  for (const [k, v] of cache) if (now - v.at >= TTL_MS) cache.delete(k);
}

// An opening tag (name, attribute text), honouring quoted values that contain ">".
const TAG = /<([a-z][^\s/>]*)((?:"[^"]*"|'[^']*'|[^'">])*)>/gi;
// One attribute, tokenised the way browsers do: `<img/onerror=…>` and
// `<img src="x"onerror=…>` both carry an onerror attribute, and an unquoted
// value runs to the next space, so `href=x/onclick=y` is one href.
const ATTR = /([^\s"'>/=]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>]+))?/g;
const URL_ATTRS = new Set(["href", "src", "xlink:href", "action", "formaction", "poster", "background"]);

const char = (code: number) => (code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : " ");

/** A URL that runs script, after undoing the entity and whitespace tricks browsers ignore. */
function scriptUrl(raw: string): boolean {
  const decoded = raw
    .replace(/^["']|["']$/g, "")
    .replace(/&#x([0-9a-f]+);?/gi, (_, h: string) => char(parseInt(h, 16)))
    .replace(/&#(\d+);?/g, (_, d: string) => char(Number(d)))
    .replace(/&colon;/gi, ":")
    .replace(/&(tab|newline);/gi, "")
    .toLowerCase();
  // Browsers ignore control characters and spaces inside the scheme.
  const v = [...decoded].filter((c) => c.charCodeAt(0) > 0x20).join("");
  return /^(javascript|vbscript):/.test(v) || (v.startsWith("data:") && !v.startsWith("data:image/"));
}

/**
 * Defense in depth on top of GitHub's own sanitising: drop active content and
 * inline handlers before the HTML reaches dangerouslySetInnerHTML. Attributes
 * are checked per tag, so text that merely looks like `onx=` is left alone.
 */
export function sanitizeHtml(html: string): string {
  return html
    .replace(/<\s*(script|style|iframe|object|embed|form|textarea|noscript)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/<\s*\/?\s*(script|style|iframe|object|embed|form|textarea|noscript|meta|link|base|animate|set|animatemotion|animatetransform)\b[^>]*>/gi, "")
    .replace(TAG, (_tag, name: string, rest: string) => {
      const kept: string[] = [];
      for (const [, attr, value] of rest.matchAll(ATTR)) {
        const n = attr!.toLowerCase();
        if (n.startsWith("on")) continue;
        if (value && URL_ATTRS.has(n) && scriptUrl(value)) continue;
        kept.push(value === undefined ? ` ${attr}` : ` ${attr}=${value}`);
      }
      return `<${name}${kept.join("")}${/\/\s*$/.test(rest) ? " /" : ""}>`;
    })
    .replace(/<a\s/gi, '<a target="_blank" rel="noreferrer noopener" ')
    // Videos in a description must be playable: GitHub sometimes leaves the
    // attributes off, and Electron refuses a video without controls.
    .replace(/<video\b([^>]*)>/gi, (_tag, attrs: string) => {
      let out = `<video${attrs}>`;
      for (const attr of ["controls", "playsinline", 'preload="metadata"']) {
        if (!new RegExp(`\\b${attr.split("=")[0]}\\b`, "i").test(attrs)) out = out.replace(/>$/, ` ${attr}>`);
      }
      return out;
    });
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function inline(s: string): string {
  return esc(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g, '<img src="$2" alt="$1">')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>')
    .replace(/(^|\s)#(\d+)\b/g, '$1<a href="https://github.com/__REPO__/issues/$2">#$2</a>');
}

/**
 * Minimal markdown → HTML (headings, lists, task lists, fenced code, inline
 * code, bold, links). Used for demo data and when GitHub is unreachable; real
 * issues use GitHub's own rendering.
 */
export function renderMarkdownLite(md: string, repo = displayRepo()): string {
  const out: string[] = [];
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  let list: "ul" | "ol" | null = null;
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) out.push(`<p>${para.map(inline).join("<br>")}</p>`);
    para = [];
  };
  const closeList = () => {
    if (list) out.push(`</${list}>`);
    list = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.startsWith("```")) {
      flushPara();
      closeList();
      const code: string[] = [];
      while (++i < lines.length && !lines[i]!.startsWith("```")) code.push(lines[i]!);
      out.push(`<pre><code>${esc(code.join("\n"))}</code></pre>`);
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    const task = /^\s*[-*]\s+\[( |x)\]\s+(.*)$/i.exec(line);
    const ul = /^\s*[-*]\s+(.*)$/.exec(line);
    const ol = /^\s*\d+\.\s+(.*)$/.exec(line);
    if (h) {
      flushPara();
      closeList();
      out.push(`<h${h[1]!.length + 1}>${inline(h[2]!)}</h${h[1]!.length + 1}>`);
    } else if (task || ul || ol) {
      flushPara();
      const kind = ol && !ul ? "ol" : "ul";
      if (list !== kind) {
        closeList();
        out.push(`<${kind}>`);
        list = kind;
      }
      if (task) out.push(`<li class="task-list-item"><input type="checkbox" disabled${task[1]!.toLowerCase() === "x" ? " checked" : ""}> ${inline(task[2]!)}</li>`);
      else out.push(`<li>${inline((ul ?? ol)![1]!)}</li>`);
    } else if (!line.trim()) {
      flushPara();
      closeList();
    } else {
      closeList();
      para.push(line);
    }
  }
  flushPara();
  closeList();
  return out.join("\n").replace(/__REPO__/g, repo);
}

type RestComment = {
  id: number;
  user?: { login?: string; avatar_url?: string } | null;
  created_at: string;
  body?: string | null;
  body_html?: string | null;
  html_url: string;
};

/** Comments per issue, kept for a minute so the panel and a suggestion share one read. */
const commentsCache = new Map<string, { at: number; comments: IssueComment[]; error: string | null }>();

function pruneComments(now: number): void {
  for (const [k, v] of commentsCache) if (now - v.at >= TTL_MS) commentsCache.delete(k);
}

/** The live comment thread (newest first is the caller's job). One request, no issue body. */
export async function fetchIssueComments(number: number, token: string, repoFull: string): Promise<{ comments: IssueComment[]; error: string | null }> {
  const key = `${repoFull}#${number}`;
  const hit = commentsCache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return { comments: hit.comments, error: hit.error };
  const [owner, repo] = repoFull.split("/") as [string, string];
  const rest = restClient(token);
  let comments: IssueComment[] = [];
  let error: string | null = null;
  try {
    const raw = (await rest.paginate(rest.issues.listComments, {
      owner,
      repo,
      issue_number: number,
      per_page: 100,
      mediaType: { format: "full" },
    })) as RestComment[];
    comments = raw.map((c) => ({
      id: String(c.id),
      author: c.user?.login ?? "ghost",
      avatarUrl: c.user?.avatar_url ?? null,
      createdAt: c.created_at,
      bodyHtml: c.body_html ? sanitizeHtml(c.body_html) : null,
      body: c.body ?? "",
      url: c.html_url,
    }));
  } catch (e) {
    error = e instanceof Error ? e.message : "could not load comments";
  }
  pruneComments(Date.now());
  commentsCache.set(key, { at: Date.now(), comments, error });
  return { comments, error };
}

export async function fetchIssueDetail(number: number, token: string, repoFull: string): Promise<IssueDetail> {
  const key = `${repoFull}#${number}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.detail;
  const [owner, repo] = repoFull.split("/") as [string, string];
  const rest = restClient(token);
  const issue = await rest.issues.get({ owner, repo, issue_number: number, mediaType: { format: "full" } });
  // The thread is cached apart from the body: a suggestion needs only the comments.
  const thread = await fetchIssueComments(number, token, repoFull);
  const data = issue.data as { body?: string | null; body_html?: string | null };
  const detail: IssueDetail = {
    number,
    body: data.body ?? "",
    bodyHtml: data.body_html ? sanitizeHtml(data.body_html) : null,
    comments: thread.comments,
    commentsError: thread.error,
    source: "github",
  };
  pruneCache(Date.now());
  cache.set(key, { at: Date.now(), detail });
  return detail;
}

function repoOf(url: string): string | undefined {
  const parsed = parseGitHubItemUrl(url);
  return parsed ? `${parsed.owner}/${parsed.repo}` : undefined;
}

/**
 * An item that left the read model (S6) is still served by number from the
 * cache, with a "no longer on GitHub" note when it was deleted or moved.
 */
async function removedDetail(number: number, reason: string | null): Promise<IssueDetail | null> {
  const row = await removedItem(number);
  if (!row) return null;
  return {
    number,
    body: row.body ?? "",
    bodyHtml: row.body ? sanitizeHtml(renderMarkdownLite(row.body, await linkRepo())) : null,
    comments: [],
    commentsError: removedNote(row.reason) ?? reason,
    source: "cache",
  };
}

/** Body from the sync cache (read per item, S5), rendered locally (no comments). */
export async function cachedDetail(store: ReadModel, number: number, reason: string | null): Promise<IssueDetail | null> {
  const issue = [...store.issues.values()].find((i) => i.number === number);
  if (!issue) return removedDetail(number, reason);
  const body = await cachedBody(issue.nodeId, issue.body);
  return {
    number,
    body: body ?? "",
    bodyHtml: body ? sanitizeHtml(renderMarkdownLite(body, repoOf(issue.url))) : null,
    comments: [],
    commentsError: reason,
    source: "cache",
  };
}

const DEMO_COMMENTS = [
  "Reproduced on the latest develop build. Looks related to the recent refactor of the account state.",
  "I can take this one. Should we wait for the design update first?",
  "Design is ready, see the **Figma** link in the parent epic.",
  "Fix is ready, needs a review from someone on the team.",
  "Tested on Windows and macOS, works fine now. Moving to QA.",
  "This also happens with two accounts, adding a note to the test plan.",
];

/** Deterministic fake thread for the demo dataset. */
export async function demoDetail(store: ReadModel, number: number): Promise<IssueDetail | null> {
  const base = await cachedDetail(store, number, null);
  if (!base) return null;
  const users = [...store.ghUsers.values()].map((u) => u.login);
  const issue = [...store.issues.values()].find((i) => i.number === number)!;
  const count = number % 4;
  const start = Date.parse(issue.createdAt);
  const span = Math.max(1, Date.parse(issue.updatedAt) - start);
  const comments: IssueComment[] = Array.from({ length: count }, (_, k) => {
    const text = DEMO_COMMENTS[(number + k) % DEMO_COMMENTS.length]!;
    return {
      id: `${number}-${k}`,
      author: users[(number + k * 3) % Math.max(1, users.length)] ?? "ghost",
      avatarUrl: null,
      createdAt: new Date(start + (span * (k + 1)) / (count + 1)).toISOString(),
      body: text,
      bodyHtml: renderMarkdownLite(text, repoOf(issue.url)),
      url: `${issue.url}#issuecomment-${k}`,
    };
  });
  return { ...base, comments, source: "demo" };
}
