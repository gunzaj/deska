// pnpm probe:pat — read-only check of what a fine-grained PAT can read
// (SPEC D1). The target comes from GITHUB_REPO, GITHUB_ORG and
// GITHUB_PROJECT_NUMBER, the token from GITHUB_TOKEN; PROBE_ISSUE_NUMBER
// optionally picks the issue for the per-issue checks. The report goes to
// private/findings/ (gitignored) and is never printed with the token in it.
//
// The client (lib/github/probe.ts) can only send REST GETs and GraphQL
// queries: running this never changes anything on GitHub.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { githubTarget } from "../lib/config";
import { createReadOnlyClient, formatReport, probeOutputPaths, redact, runProbe } from "../lib/github/probe";

async function main() {
  const token = process.env.GITHUB_TOKEN?.trim() ?? "";
  if (!token) {
    console.error("probe:pat needs GITHUB_TOKEN (a read-only fine-grained PAT).");
    process.exit(1);
  }
  const { owner, repo, org, projectNumber } = githubTarget();
  const issueRaw = process.env.PROBE_ISSUE_NUMBER?.trim();
  const issueNumber = issueRaw ? Number(issueRaw) : undefined;
  if (issueNumber !== undefined && !(Number.isInteger(issueNumber) && issueNumber > 0)) {
    console.error("PROBE_ISSUE_NUMBER must be a positive issue number.");
    process.exit(1);
  }

  const report = await runProbe(createReadOnlyClient(token), { owner, repo, org, projectNumber, issueNumber });
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const out = probeOutputPaths(root, report.ranAt);
  mkdirSync(out.dir, { recursive: true });
  const md = redact(formatReport(report), token);
  writeFileSync(out.json, redact(JSON.stringify(report, null, 2), token) + "\n");
  writeFileSync(out.md, md);
  console.log(md);
  console.log(`Saved to ${out.json} and ${out.md}`);
}

main().catch((e) => {
  const token = process.env.GITHUB_TOKEN?.trim() ?? "";
  console.error(redact(e instanceof Error ? (e.stack ?? e.message) : String(e), token));
  process.exit(1);
});
