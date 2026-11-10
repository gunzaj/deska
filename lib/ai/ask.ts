// Ask answers (SPEC §4.9, AI4): the task the model is asked for. Pure: the
// server assembles the input from the issue cache and the tests build the same
// task from fixtures. The schema is built per request with an enum of real issue
// numbers ("Closed choices"), so an issue that is not in the material cannot come
// back. An answer is text: nothing changes until the user acts on it.
import { createHash } from "node:crypto";
import { z } from "zod/v4";
import { ASK_INSTRUCTIONS } from "./prompts/ask";
import type { AiTask } from "./prompt";
import { triageData, type TriageIssueInput } from "./triage";

export const ASK_FEATURE = "ask";
export const ASK_ISSUE_SUBJECT_KIND = "issue";
export const ASK_LIST_SUBJECT_KIND = "list";
/** How many rows of an issue list one answer is built from (SPEC §4.9, AI4). */
export const MAX_ASK_ROWS = 200;
/** How many issue references one answer may name. */
export const MAX_ASK_REFERENCES = 20;
/** Characters of the user's question. */
export const MAX_ASK_QUESTION = 1_000;
/** Characters of the model's answer. */
export const MAX_ASK_ANSWER = 4_000;
/** Characters of one row's title in the issues block. */
const MAX_ROW_TITLE = 300;

/** What the model answers: markdown text and the issue numbers it relies on (as strings, for the enum). */
export type AskAnswer = { answer: string; references: string[] };

/** One row of an issue list: what an answer may name (SPEC §4.9, AI4). */
export type AskRow = {
  number: number;
  title: string;
  state: string;
  /** The mapped fields (§4.1), by their project names, with the current value or null. */
  fields: { name: string; value: string | null }[];
  labels: string[];
  /** The issue's `updated_at`: part of the input hash, never sent. */
  version: string;
};

/** Everything an answer about an issue is built from: the issue as in triage, plus the question. */
export type AskIssueInput = TriageIssueInput & { question: string };

/** Everything an answer about a list is built from. */
export type AskListInput = { question: string; rows: AskRow[]; total: number };

/** A stored answer as `ai_results.result`: the question, the answer and its references. */
export const storedAskSchema = z.object({
  question: z.string().min(1).max(MAX_ASK_QUESTION),
  answer: z.string().min(1).max(MAX_ASK_ANSWER),
  references: z.array(z.string().regex(/^\d{1,10}$/)).max(MAX_ASK_REFERENCES),
  /** The list's full row count and how many rows were sent (list answers only). */
  total: z.number().int().positive().optional(),
  sent: z.number().int().positive().optional(),
});
export type StoredAsk = z.infer<typeof storedAskSchema>;

/**
 * The answer schema, built per request: the references are an enum of the real
 * issue numbers of the material (SPEC §4.9 "Closed choices"), so an issue that is
 * not in the issue or the list cannot come back.
 */
export function askSchema(references: string[]): z.ZodType<AskAnswer> {
  const ref = references.length ? z.enum(references) : z.string().max(0);
  return z.object({
    answer: z.string().min(1).max(MAX_ASK_ANSWER),
    references: z.array(ref).max(MAX_ASK_REFERENCES),
  }) as unknown as z.ZodType<AskAnswer>;
}

/** The answer with each reference once; the schema already keeps them in the material. */
export function normalizeAskAnswer(answer: AskAnswer): AskAnswer {
  return { answer: answer.answer, references: [...new Set(answer.references)].slice(0, MAX_ASK_REFERENCES) };
}

/**
 * The numbers an answer about an issue may name: the issue itself, its parent
 * and the possible duplicates (the same material triage sends).
 */
export function issueReferences(input: Pick<TriageIssueInput, "number" | "parent" | "candidates">): string[] {
  const numbers = [input.number, ...(input.parent ? [input.parent.number] : []), ...input.candidates.map((c) => c.number)];
  return [...new Set(numbers)].sort((a, b) => a - b).map(String);
}

/**
 * A list's identity in `ai_results`: the sorted issue numbers that were sent, so
 * a list with other rows is a different subject (and a changed row is the same
 * subject, marked outdated by the input hash).
 */
export function askListSubject(numbers: number[]): string {
  const sorted = [...new Set(numbers)].sort((a, b) => a - b);
  return `list:${createHash("sha256").update(sorted.join(",")).digest("hex").slice(0, 16)}`;
}

/** Everything that changes about a list: its size, the question and each row's values. */
export function askListVersion(input: Pick<AskListInput, "question" | "total" | "rows">): string {
  const rows = input.rows.map((r) => [r.number, r.version, r.title, r.state, r.fields, r.labels]);
  return JSON.stringify([input.question, input.total, rows]);
}

const trim = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max).trimEnd()}…`);
const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

/** One row's line in the issues block: its number, title, state, mapped fields and labels. */
function rowLine(r: AskRow): string {
  const fields = r.fields.map((f) => `${oneLine(f.name)}: ${f.value ? oneLine(f.value) : "(empty)"}`).join(", ");
  const labels = r.labels.length ? r.labels.map(oneLine).join(", ") : "(none)";
  return `#${r.number} ${trim(oneLine(r.title), MAX_ROW_TITLE)} — ${r.state} — ${fields || "(no mapped fields)"} — labels: ${labels}`;
}

/** The untrusted content of a list answer, each block separate and labelled (SPEC §4.9 "Untrusted input"). */
function listData(input: AskListInput): { label: string; text: string }[] {
  const rows = input.rows.slice(0, MAX_ASK_ROWS);
  const context = input.total > rows.length ? `The list has ${input.total} issues; the first ${rows.length} are below.` : `The list has ${rows.length} issues, all below.`;
  return [
    { label: "list", text: context },
    { label: "question", text: input.question },
    { label: "issues", text: rows.length ? rows.map(rowLine).join("\n") : "(no issues)" },
  ];
}

/** The task: prompt version, data blocks, schema and the subject's version (input hash). */
export function askIssueTask(input: AskIssueInput): AiTask {
  return {
    feature: ASK_FEATURE,
    subjectKind: ASK_ISSUE_SUBJECT_KIND,
    subject: String(input.number),
    // The question is part of the input: asking another one is a different answer.
    subjectVersion: `${input.updatedAt}#${input.question}`,
    instructions: ASK_INSTRUCTIONS,
    data: [...triageData(input), { label: "question", text: input.question }],
    schema: askSchema(issueReferences(input)),
    schemaName: "ask_issue",
    resultMeta: { question: input.question },
  };
}

/** The task for a list: only its first `MAX_ASK_ROWS` rows are sent (SPEC §4.9, AI4). */
export function askListTask(input: AskListInput): AiTask {
  const rows = input.rows.slice(0, MAX_ASK_ROWS);
  return {
    feature: ASK_FEATURE,
    subjectKind: ASK_LIST_SUBJECT_KIND,
    subject: askListSubject(rows.map((r) => r.number)),
    subjectVersion: askListVersion({ ...input, rows }),
    instructions: ASK_INSTRUCTIONS,
    data: listData({ ...input, rows }),
    schema: askSchema(rows.map((r) => String(r.number))),
    schemaName: "ask_list",
    resultMeta: { question: input.question, total: input.total, sent: rows.length },
  };
}
