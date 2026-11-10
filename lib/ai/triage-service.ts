// Issue triage suggestions, assembled on the server (SPEC §4.9, AI1): the issue
// from the cache, its body, comments (live when GitHub is reachable), labels,
// mapped fields with their real options, parent and the possible duplicates.
// The model is asked only here, when the user asks; a suggestion is text until
// the user accepts it.
import { randomUUID } from "node:crypto";
import { dbDir } from "@/db";
import { localToken } from "../github/local-token";
import { cachedBody } from "../server/bodies";
import { duplicatesOf } from "../server/duplicates";
import { demoDetail, fetchIssueDetail } from "../server/issue-detail";
import { readAiSettings } from "../settings";
import { getStore } from "../store";
import { inputHash } from "./prompt";
import { startJob, type Job } from "./runner";
import { aiStatus, type AiStatus } from "./status";
import { latestResultRow, type StoredResult } from "./results";
import { MAX_TRIAGE_CANDIDATES, TRIAGE_FEATURE, triageFieldChoices, triageTask, type TriageIssueInput, type TriageSuggestion } from "./triage";
import type { ReadModel } from "../sync/read-model";

export type { AiStatus } from "./status";

/** A stored suggestion as the page shows it. */
export type TriageSuggestionView = {
  /** The `ai_results` id, null without a database (demo and tests). */
  id: string | null;
  result: TriageSuggestion;
  provider: string;
  model: string;
  createdAt: string;
  acceptedAt: string | null;
  dismissedAt: string | null;
  /** False once the issue changed on GitHub: "Outdated · Run again" (SPEC §4.9). */
  fresh: boolean;
};

/**
 * Comments for the suggestion's input: the live thread when GitHub answers, the
 * cached description without a token. Newest first (SPEC §4.9). A failure keeps
 * the suggestion possible: the cached description still goes.
 */
async function commentsFor(store: ReadModel, issue: { number: number; nodeId: string }): Promise<{ author: string; body: string; createdAt: string }[]> {
  try {
    if (!dbDir()) return (await demoDetail(store, issue.number))?.comments ?? [];
    const token = localToken();
    if (token) return (await fetchIssueDetail(issue.number, token)).comments;
  } catch {
    // GitHub unreachable: the cached description is still useful.
  }
  return [];
}

/** Everything a suggestion for this issue is built from, or null when it isn't cached. */
export async function triageInput(number: number): Promise<TriageIssueInput | null> {
  const store = await getStore();
  const issue = store.issueByNumber(number);
  if (!issue) return null;
  const mapping = store.projectFieldMap();
  const [body, comments, candidates] = await Promise.all([
    cachedBody(issue.nodeId, issue.body),
    commentsFor(store, issue),
    duplicatesOf(number, MAX_TRIAGE_CANDIDATES),
  ]);
  const parent = issue.parentNodeId ? store.issues.get(issue.parentNodeId) : undefined;
  return {
    number: issue.number,
    title: issue.title,
    state: issue.state,
    author: issue.authorLogin,
    updatedAt: issue.updatedAt,
    url: issue.url,
    body,
    comments: comments.map((c) => ({ author: c.author, body: c.body, createdAt: c.createdAt })),
    parent: parent ? { number: parent.number, title: parent.title, state: parent.state } : null,
    labels: issue.labelIds.flatMap((id) => {
      const label = store.labels.get(id);
      return label ? [{ id, name: label.name }] : [];
    }),
    repoLabels: [...store.labels].map(([id, label]) => ({ id, name: label.name })),
    choices: triageFieldChoices(store, mapping, issue),
    candidates: (candidates ?? []).map((c) => ({ number: c.number, title: c.title, state: c.state })),
  };
}

function suggestionView(row: StoredResult, fresh: boolean): TriageSuggestionView {
  return {
    id: row.id,
    result: row.result as TriageSuggestion,
    provider: row.provider,
    model: row.model,
    createdAt: row.createdAt.toISOString(),
    acceptedAt: row.acceptedAt?.toISOString() ?? null,
    dismissedAt: row.dismissedAt?.toISOString() ?? null,
    fresh,
  };
}

/**
 * The issue's newest suggestion and whether AI may run, or null when the issue
 * isn't in the cache. Rebuilding the input gives the hash: a changed issue (or
 * prompt, schema or extra instructions) makes the stored suggestion outdated.
 * Without a stored suggestion nothing is built and nothing is fetched.
 */
export async function latestTriageSuggestion(number: number): Promise<{ suggestion: TriageSuggestionView | null; ai: AiStatus } | null> {
  const store = await getStore();
  if (!store.issueByNumber(number)) return null;
  const ai = await aiStatus();
  const settings = await readAiSettings();
  const row = await latestResultRow(TRIAGE_FEATURE, String(number));
  if (!row) return { suggestion: null, ai };
  const input = await triageInput(number);
  if (!input) return null;
  const fresh = row.inputHash === inputHash(triageTask(input), settings.extraInstructions);
  return { suggestion: suggestionView(row, fresh), ai };
}

/** Asks the model for a suggestion for this issue; null when it isn't cached. */
export async function startIssueTriage(number: number): Promise<Job | null> {
  const input = await triageInput(number);
  return input ? startJob(triageTask(input)) : null;
}

/**
 * Asks for one suggestion per issue of a queue (SPEC §4.9 batch): one job each,
 * sharing a batch id, run one at a time by the runner. All numbers are checked
 * before the first job starts, so a stale queue starts nothing.
 */
export async function startQueueTriage(numbers: number[]): Promise<{ batchId: string | null; jobs: Job[]; missing: number[] }> {
  const inputs: TriageIssueInput[] = [];
  const missing: number[] = [];
  for (const n of numbers) {
    const input = await triageInput(n);
    if (input) inputs.push(input);
    else missing.push(n);
  }
  if (missing.length) return { batchId: null, jobs: [], missing };
  const batchId = randomUUID();
  const jobs = await Promise.all(inputs.map((input) => startJob(triageTask(input), { batchId })));
  return { batchId, jobs, missing: [] };
}
