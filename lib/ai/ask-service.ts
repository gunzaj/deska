// Ask, assembled on the server (SPEC §4.9, AI4): the issue as triage reads it,
// or the rows of an issue list from the cache, plus the user's question. The
// model is asked only here, when the user asks; an answer is text until the user
// acts on it (it never is a GitHub write).
import { linkRepo, readAiSettings } from "../settings";
import { getStore } from "../store";
import type { FieldMapping } from "../sync/field-map";
import type { IssueRow, ReadModel } from "../sync/read-model";
import {
  ASK_FEATURE,
  askIssueTask,
  askListSubject,
  askListTask,
  MAX_ASK_ROWS,
  storedAskSchema,
  type AskIssueInput,
  type AskListInput,
  type AskRow,
  type StoredAsk,
} from "./ask";
import { answerHtml } from "./ask-html";
import { inputHash } from "./prompt";
import { latestResultRow, type StoredResult } from "./results";
import { startJob, type Job } from "./runner";
import { aiStatus, type AiStatus } from "./status";
import { triageInput } from "./triage-service";

/** A stored answer as the page shows it. */
export type AskAnswerView = {
  /** The `ai_results` id, null without a database (demo and tests). */
  id: string | null;
  question: string;
  /** The model's answer as markdown. */
  answer: string;
  /** The answer as HTML: only https://github.com/… links are clickable (SPEC §4.9). */
  answerHtml: string;
  /** The issue numbers the answer relies on (real issues of the material only). */
  references: number[];
  provider: string;
  model: string;
  createdAt: string;
  /** False once the issue or the list changed: "Outdated · Run again" (SPEC §4.9). */
  fresh: boolean;
};

/** The issue's latest answer (or none) and whether AI may run. */
export type AskView = { answer: AskAnswerView | null; ai: AiStatus };

/** The issue as triage reads it, plus the question: everything a suggestion is built from. */
export async function askIssueInput(number: number, question: string): Promise<AskIssueInput | null> {
  const input = await triageInput(number);
  return input ? { ...input, question } : null;
}

/**
 * One row of an issue list (SPEC §4.9, AI4): its number, title, state, mapped
 * fields and labels. A remapped field's value is in `dims` by field ID (D4).
 */
function askRow(store: ReadModel, mapping: FieldMapping, issue: IssueRow): AskRow {
  const item = store.itemForIssue(issue.nodeId);
  const fields: { name: string; value: string | null }[] = [];
  const single = (ref: { id: string; name: string } | null, key: "statusOpt" | "priorityOpt") => {
    const field = ref ? store.fields.get(ref.id) : undefined;
    if (!ref || !field) return;
    const value = item?.[key] ?? item?.dims?.[ref.id] ?? null;
    fields.push({ name: field.name, value: value ? (field.options.find((o) => o.id === value)?.name ?? null) : null });
  };
  single(mapping.status, "statusOpt");
  single(mapping.priority, "priorityOpt");
  for (const dim of mapping.dimensions) {
    const field = store.fields.get(dim.id);
    if (!field) continue;
    const value = item?.dims?.[dim.id] ?? null;
    fields.push({ name: field.name, value: value ? (field.options.find((o) => o.id === value)?.name ?? null) : null });
  }
  const sprintField = mapping.sprint ? store.fields.get(mapping.sprint.id) : undefined;
  if (mapping.sprint) {
    const value = item?.releaseIter ?? item?.dims?.[mapping.sprint.id] ?? null;
    fields.push({ name: sprintField?.name ?? mapping.sprint.name, value: value ? (sprintField?.iterations.find((it) => it.id === value)?.title ?? null) : null });
  }
  return {
    number: issue.number,
    title: issue.title,
    state: issue.state,
    fields,
    labels: issue.labelIds.flatMap((id) => {
      const label = store.labels.get(id);
      return label ? [label.name] : [];
    }),
    version: issue.updatedAt,
  };
}

/** The rows of a list, in the given order; a number that left the cache is skipped. */
async function listRows(numbers: number[]): Promise<AskRow[]> {
  const store = await getStore();
  const mapping = store.projectFieldMap();
  return numbers.slice(0, MAX_ASK_ROWS).flatMap((n) => {
    const issue = store.issueByNumber(n);
    return issue ? [askRow(store, mapping, issue)] : [];
  });
}

/** A list's input: the cached rows of the numbers and the list's full size. */
export async function askListInput(numbers: number[], question: string, total: number): Promise<AskListInput | null> {
  const rows = await listRows(numbers);
  if (!rows.length) return null;
  return { question, rows, total: Math.max(total, numbers.length) };
}

/** The stored answer as `ai_results.result`, or null when it isn't one. */
function storedAnswer(row: StoredResult): StoredAsk | null {
  const parsed = storedAskSchema.safeParse(row.result);
  return parsed.success ? parsed.data : null;
}

function answerView(row: StoredResult, stored: StoredAsk, fresh: boolean, repo: string): AskAnswerView {
  return {
    id: row.id,
    question: stored.question,
    answer: stored.answer,
    answerHtml: answerHtml(stored.answer, repo),
    references: stored.references.map(Number).filter((n) => Number.isInteger(n) && n > 0),
    provider: row.provider,
    model: row.model,
    createdAt: row.createdAt.toISOString(),
    fresh,
  };
}

/**
 * The issue's newest answer and whether AI may run, or null when the issue isn't
 * cached. Rebuilding the input gives the hash: a changed issue, question, prompt,
 * schema or extra instructions makes the stored answer outdated. Without a stored
 * answer nothing is built and nothing is fetched.
 */
export async function latestIssueAnswer(number: number): Promise<AskView | null> {
  const store = await getStore();
  if (!store.issueByNumber(number)) return null;
  const ai = await aiStatus();
  const row = await latestResultRow(ASK_FEATURE, String(number));
  if (!row) return { answer: null, ai };
  const stored = storedAnswer(row);
  if (!stored) return { answer: null, ai };
  const input = await askIssueInput(number, stored.question);
  if (!input) return null;
  const settings = await readAiSettings();
  const fresh = row.inputHash === inputHash(askIssueTask(input), settings.extraInstructions);
  return { answer: answerView(row, stored, fresh, await linkRepo()), ai };
}

/** Asks the model for an answer about this issue; null when it isn't cached. */
export async function startIssueAsk(number: number, question: string): Promise<Job | null> {
  const input = await askIssueInput(number, question);
  return input ? startJob(askIssueTask(input)) : null;
}

/**
 * The list's newest answer and whether AI may run. The list's identity is the
 * sorted set of issue numbers sent, so a different list is a different subject;
 * a changed row of the same list makes the stored answer outdated.
 */
export async function latestListAnswer(numbers: number[], total: number): Promise<AskView> {
  const ai = await aiStatus();
  const rows = await listRows(numbers);
  const sent = rows.map((r) => r.number);
  const row = sent.length ? await latestResultRow(ASK_FEATURE, askListSubject(sent)) : null;
  if (!row) return { answer: null, ai };
  const stored = storedAnswer(row);
  if (!stored) return { answer: null, ai };
  const input: AskListInput = { question: stored.question, rows, total: Math.max(total, numbers.length) };
  const settings = await readAiSettings();
  const fresh = row.inputHash === inputHash(askListTask(input), settings.extraInstructions);
  return { answer: answerView(row, stored, fresh, await linkRepo()), ai };
}

/** Asks the model for an answer about this list; null when none of its rows is cached. */
export async function startListAsk(numbers: number[], question: string, total: number): Promise<Job | null> {
  const input = await askListInput(numbers, question, total);
  return input ? startJob(askListTask(input)) : null;
}
