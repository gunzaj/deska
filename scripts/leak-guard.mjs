#!/usr/bin/env node
// Leak guard: keeps private names, secrets and personal emails out of this
// public repo. No dependencies, so it runs in hooks and CI before `pnpm install`.
//
//   node scripts/leak-guard.mjs --staged [--identity]   staged files (pre-commit)
//   node scripts/leak-guard.mjs --all                   every tracked file (CI)
//   node scripts/leak-guard.mjs --message <file>        a commit message (commit-msg)
//
// Generic checks always run. Terms in `private/denylist.txt` (gitignored, one
// per line, `#` comments) are checked too when that file exists, case- and
// accent-insensitively.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const args = process.argv.slice(2);
const mode = args.includes("--all") ? "all" : args.includes("--message") ? "message" : "staged";

const fold = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const DENYLIST_PATH = "private/denylist.txt";
const denylist = existsSync(DENYLIST_PATH)
  ? readFileSync(DENYLIST_PATH, "utf8")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"))
      .map(fold)
  : [];

const SECRET_PATTERNS = [
  ["GitHub token", /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}\b/],
  ["GitHub fine-grained token", /\bgithub_pat_[A-Za-z0-9_]{22,}/],
  ["private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/],
];

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const ALLOWED_EMAIL_DOMAINS = ["users.noreply.github.com", "example.com", "example.org", "example.net"];
const ALLOWED_EMAILS = new Set(["noreply@anthropic.com"]);
const emailAllowed = (e) => {
  const lower = e.toLowerCase();
  if (ALLOWED_EMAILS.has(lower)) return true;
  const domain = lower.split("@")[1];
  return ALLOWED_EMAIL_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`));
};

const git = (...a) => execFileSync("git", a, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const problems = [];

function scanText(label, text, { genericChecks = true } = {}) {
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    const where = `${label}:${i + 1}`;
    if (genericChecks) {
      for (const [name, re] of SECRET_PATTERNS) if (re.test(line)) problems.push(`${where}: looks like a ${name}`);
      for (const e of line.match(EMAIL) ?? []) if (!emailAllowed(e)) problems.push(`${where}: email address "${e}" (use a noreply or example.com address)`);
    }
    if (denylist.length) {
      const folded = fold(line);
      for (const term of denylist) if (folded.includes(term)) problems.push(`${where}: contains private term "${term}"`);
    }
  });
}

function scanPath(path) {
  if (path === "private" || path.startsWith("private/")) problems.push(`${path}: files under private/ must never be committed`);
  if (path.startsWith(".env") && path !== ".env.example") problems.push(`${path}: .env files must never be committed`);
  scanText(`${path} (path)`, path);
}

function isBinary(buf) {
  return buf.subarray(0, 8000).includes(0);
}

if (mode === "message") {
  const file = args[args.indexOf("--message") + 1];
  scanText("commit message", readFileSync(file, "utf8"));
} else {
  const files =
    mode === "all"
      ? git("ls-files", "-z").split("\0").filter(Boolean)
      : git("diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z").split("\0").filter(Boolean);
  for (const path of files) {
    // This file holds the secret/email patterns themselves; it still gets the denylist check.
    const genericChecks = path !== "scripts/leak-guard.mjs";
    scanPath(path);
    const buf =
      mode === "all"
        ? existsSync(path)
          ? readFileSync(path)
          : Buffer.alloc(0)
        : execFileSync("git", ["show", `:${path}`], { maxBuffer: 64 * 1024 * 1024 });
    if (!isBinary(buf)) scanText(path, buf.toString("utf8"), { genericChecks });
  }
  if (args.includes("--identity")) {
    const email = git("config", "user.email").trim();
    if (!emailAllowed(email) || !email.endsWith("users.noreply.github.com"))
      problems.push(`git user.email "${email}" is not a GitHub noreply address`);
  }
}

if (!denylist.length && mode !== "all") {
  console.warn(`leak-guard: ${DENYLIST_PATH} not found; only generic checks ran.`);
}

if (problems.length) {
  console.error(`leak-guard: ${problems.length} problem(s):\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
