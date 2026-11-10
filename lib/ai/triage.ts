// Issue triage suggestions (SPEC §4.9, AI1): the task the model is asked for.
// Pure: the server assembles the issue from the cache and the tests build the
// same task from fixtures. One definition gives the prompt, the data blocks and
// the schema, and the schema is built per request with enums of real IDs
// ("Closed choices"), so a value that does not exist cannot come back.
import { z } from "zod/v4";
import type { FieldMapping } from "../sync/field-map";
import type { IssueRow, ReadModel } from "../sync/read-model";
import { ISSUE_TRIAGE_INSTRUCTIONS } from "./prompts/issue-triage";
import type { AiTask } from "./prompt";

export const TRIAGE_FEATURE = "issue-triage";
export const TRIAGE_SUBJECT_KIND = "issue";
/** How many possible duplicates the model may choose from (SPEC §4.9: up to 10). */
export const MAX_TRIAGE_CANDIDATES = 10;
/** Characters of issue text (description and newest comments) sent per issue (SPEC §4.9). */
export const MAX_TRIAGE_TEXT = 12_000;
/** Characters of one comment, before the issue's text budget applies. */
const MAX_COMMENT = 4_000;

export type TriageConfidence = "low" | "medium" | "high";
/** A field suggestion: an option ID from the choices, why, and how sure the model is. */
export type TriageFieldSuggestion = { id: string; reason: string; confidence: TriageConfidence };
export type TriageLabelSuggestion = TriageFieldSuggestion;
export type TriageFlagName = "needs_info" | "probably_fixed" | "stale";
export type TriageFlag = { flag: TriageFlagName; reason: string };

/** What the model answers (the schema only lists the parts the project and repo have). */
export type TriageSuggestion = {
  summary: string;
  status?: TriageFieldSuggestion | null;
  priority?: TriageFieldSuggestion | null;
  dimension?: TriageFieldSuggestion | null;
  sprint?: TriageFieldSuggestion | null;
  labels?: TriageLabelSuggestion[];
  /** The number of one of the candidates, or null. */
  duplicateOf?: string | null;
  flags?: TriageFlag[];
};

/** One mapped field the model may suggest a value for, with its real options. */
export type TriageFieldChoice = { name: string; options: { id: string; name: string }[]; current: string | null };

/** The mapped fields that have options, with the issue's current values. */
export type TriageFieldChoices = {
  status: TriageFieldChoice | null;
  priority: TriageFieldChoice | null;
  /** The first mapped dimension (§4.1), the one triage uses. */
  dimension: TriageFieldChoice | null;
  sprint: TriageFieldChoice | null;
};

export type TriageCandidate = { number: number; title: string; state: "open" | "closed" };

/** Everything a suggestion is built from. The server reads it from the cache. */
export type TriageIssueInput = {
  number: number;
  title: string;
  state: string;
  author: string;
  updatedAt: string;
  url: string;
  body: string | null;
  /** Newest first (SPEC §4.9). */
  comments: { author: string; body: string; createdAt: string }[];
  parent: { number: number; title: string; state: string } | null;
  /** The issue's own labels. */
  labels: { id: string; name: string }[];
  /** Every label in the repository: the closed choices for `labels` (§4.9). */
  repoLabels: { id: string; name: string }[];
  choices: TriageFieldChoices;
  /** From the existing possible-duplicates search, best first. */
  candidates: TriageCandidate[];
};

const CONFIDENCE = z.enum(["low", "medium", "high"]);
const FLAGS = z.enum(["needs_info", "probably_fixed", "stale"]);

const fieldSuggestion = (ids: string[]) =>
  z.object({ id: z.enum(ids), reason: z.string().min(1).max(300), confidence: CONFIDENCE }).nullable();

/**
 * The answer schema, built per request: enums of the real option, iteration and
 * label IDs, and of the candidate numbers (SPEC §4.9 "Closed choices"). A
 * mapped field with no options, or a repo with no labels, leaves its key out.
 */
export function triageSchema(input: Pick<TriageIssueInput, "choices" | "repoLabels" | "candidates">): z.ZodType<TriageSuggestion> {
  const shape: Record<string, z.ZodType> = { summary: z.string().min(1).max(2_000) };
  const { status, priority, dimension, sprint } = input.choices;
  if (status?.options.length) shape.status = fieldSuggestion(status.options.map((o) => o.id));
  if (priority?.options.length) shape.priority = fieldSuggestion(priority.options.map((o) => o.id));
  if (dimension?.options.length) shape.dimension = fieldSuggestion(dimension.options.map((o) => o.id));
  if (sprint?.options.length) shape.sprint = fieldSuggestion(sprint.options.map((o) => o.id));
  if (input.repoLabels.length) {
    shape.labels = z
      .array(z.object({ id: z.enum(input.repoLabels.map((l) => l.id)), reason: z.string().min(1).max(300), confidence: CONFIDENCE }))
      .max(5);
  }
  shape.duplicateOf = input.candidates.length ? z.enum(input.candidates.map((c) => String(c.number))).nullable() : z.null();
  shape.flags = z.array(z.object({ flag: FLAGS, reason: z.string().min(1).max(300) })).max(3);
  return z.object(shape) as unknown as z.ZodType<TriageSuggestion>;
}

const trim = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max).trimEnd()}…`);

/** The option names and IDs the model chooses from, with the issue's current value. */
function choicesText(choices: TriageFieldChoices): string {
  const one = (c: TriageFieldChoice) => {
    const current = c.options.find((o) => o.id === c.current)?.name;
    return `${c.name}: ${current ? current : "(empty)"} — options: ${c.options.map((o) => `${o.name} (${o.id})`).join(", ")}`;
  };
  const lines = [choices.status, choices.priority, choices.dimension, choices.sprint].filter((c): c is TriageFieldChoice => !!c && c.options.length > 0).map(one);
  return lines.length ? lines.join("\n") : "(no mapped fields with options)";
}

/** The untrusted content, each block separate and labelled (SPEC §4.9 "Untrusted input"). */
function data(input: TriageIssueInput): { label: string; text: string }[] {
  const out: { label: string; text: string }[] = [];
  const head = [`#${input.number} ${input.title}`, `State: ${input.state}`, `Author: ${input.author}`, `Updated: ${input.updatedAt}`, `URL: ${input.url}`];
  if (input.parent) head.push(`Parent: #${input.parent.number} ${input.parent.title} (${input.parent.state})`);
  out.push({ label: "issue", text: head.join("\n") });

  const description = trim(input.body ?? "", MAX_TRIAGE_TEXT);
  out.push({ label: "description", text: description || "(no description)" });

  if (input.comments.length) {
    let budget = MAX_TRIAGE_TEXT - description.length;
    const comments: string[] = [];
    for (const c of input.comments) {
      if (budget <= 0) break;
      const text = trim(`@${c.author} (${c.createdAt}):\n${c.body.trim()}`, Math.min(MAX_COMMENT, budget));
      if (!text) continue;
      comments.push(text);
      budget -= text.length;
    }
    out.push({ label: "comments, newest first", text: comments.join("\n\n") || "(no comments)" });
  }

  out.push({ label: "labels", text: input.labels.length ? input.labels.map((l) => `${l.name} (${l.id})`).join(", ") : "(none)" });
  out.push({ label: "available labels", text: input.repoLabels.length ? input.repoLabels.map((l) => `${l.name} (${l.id})`).join(", ") : "(none)" });
  out.push({ label: "project fields", text: choicesText(input.choices) });
  if (input.candidates.length) {
    out.push({ label: "possible duplicates", text: input.candidates.map((c) => `#${c.number} ${c.title} (${c.state})`).join("\n") });
  }
  return out;
}

/** The task: prompt version, data blocks, schema and the issue's `updated_at` (input hash). */
export function triageTask(input: TriageIssueInput): AiTask {
  return {
    feature: TRIAGE_FEATURE,
    subjectKind: TRIAGE_SUBJECT_KIND,
    subject: String(input.number),
    subjectVersion: input.updatedAt,
    instructions: ISSUE_TRIAGE_INSTRUCTIONS,
    data: data(input),
    schema: triageSchema(input),
    schemaName: "issue_triage",
  };
}

/**
 * The mapped fields with their real options and the issue's current values
 * (§4.1). A mapped field the project no longer lists is left out, never
 * offered with stale options; the dimension is the first mapped one.
 */
export function triageFieldChoices(store: ReadModel, mapping: FieldMapping, issue: Pick<IssueRow, "nodeId">): TriageFieldChoices {
  const item = store.itemForIssue(issue.nodeId);
  const fieldOf = (ref: { id: string } | null) => (ref ? store.fields.get(ref.id) : undefined);
  // A remapped field's value is in `dims` by field ID (D4).
  const current = (ref: { id: string } | null, key: "statusOpt" | "priorityOpt" | "releaseIter") => {
    if (!ref) return null;
    return item?.[key] ?? item?.dims?.[ref.id] ?? null;
  };
  const dimValue = (ref: { id: string } | null) => (ref ? (item?.dims?.[ref.id] ?? null) : null);
  const choice = (ref: { id: string; name: string } | null, value: string | null): TriageFieldChoice | null => {
    const field = fieldOf(ref);
    const options = field?.options ?? [];
    if (!ref || !options.length) return null;
    return { name: field!.name, options: options.map((o) => ({ id: o.id, name: o.name })), current: options.some((o) => o.id === value) ? value : null };
  };
  const sprint = mapping.sprint;
  const sprintField = fieldOf(sprint);
  const iterations = (sprintField?.iterations ?? []).map((it) => ({ id: it.id, name: it.title }));
  return {
    status: choice(mapping.status, current(mapping.status, "statusOpt")),
    priority: choice(mapping.priority, current(mapping.priority, "priorityOpt")),
    dimension: mapping.dimensions[0] ? choice(mapping.dimensions[0]!, dimValue(mapping.dimensions[0]!)) : null,
    sprint: sprint ? { name: sprintField?.name ?? sprint.name, options: iterations, current: current(sprint, "releaseIter") } : null,
  };
}
