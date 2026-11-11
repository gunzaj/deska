// Ramble (item 13): one spoken transcript becomes a list of tasks. Pure: the
// server assembles the input from the task store, and the tests build the same
// task from fixtures. The schema is built per request with enums of the real
// project, section and label IDs ("Closed choices"), so a value that does not
// exist cannot come back.
import { z } from "zod/v4";
import { isIsoDate } from "../tasks/dates";
import { TITLE_MAX } from "../tasks/model";
import { RAMBLE_INSTRUCTIONS } from "./prompts/ramble";
import type { AiTask } from "./prompt";

export const RAMBLE_FEATURE = "ramble";
/** Characters of transcript sent to the model. */
export const MAX_TRANSCRIPT = 8_000;
/** Most tasks one Ramble creates. */
export const MAX_RAMBLE_TASKS = 12;

export type RambleProject = { id: string; name: string; sections: { id: string; name: string }[] };

/** Everything a Ramble parse is built from. */
export type RambleInput = {
  transcript: string;
  today: string;
  now: string;
  tz: string;
  projects: RambleProject[];
  labels: { id: string; name: string }[];
  /** A short stable hash of the transcript: the result's subject and version. */
  subjectVersion: string;
};

export type RambleTaskSuggestion = {
  title: string;
  dueDate: string | null;
  dueTime: string | null;
  priority: number;
  projectId?: string | null;
  sectionId?: string | null;
  labelIds?: string[];
  reason: string;
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** The answer schema, built per request with enums of the real project, section and label IDs. */
export function rambleSchema(input: Pick<RambleInput, "projects" | "labels">): z.ZodType<{ tasks: RambleTaskSuggestion[] }> {
  const sections = input.projects.flatMap((p) => p.sections);
  const shape: Record<string, z.ZodType> = {
    title: z.string().trim().min(1).max(TITLE_MAX),
    dueDate: z.string().regex(DATE).refine(isIsoDate, "not a calendar date").nullable(),
    dueTime: z.string().regex(TIME).nullable(),
    priority: z.number().int().min(1).max(4),
    reason: z.string().min(1).max(300),
  };
  if (input.projects.length) shape.projectId = z.enum(input.projects.map((p) => p.id)).nullable();
  if (sections.length) shape.sectionId = z.enum(sections.map((s) => s.id)).nullable();
  if (input.labels.length) shape.labelIds = z.array(z.enum(input.labels.map((l) => l.id))).max(5);
  return z.object({ tasks: z.array(z.object(shape)).min(1).max(MAX_RAMBLE_TASKS) }) as unknown as z.ZodType<{ tasks: RambleTaskSuggestion[] }>;
}

/** A short stable hash of the transcript (not a security hash: a subject key). */
export function rambleHash(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** The task: prompt version, data blocks, schema and the transcript's hash. */
export function rambleTask(input: RambleInput): AiTask {
  const projects = input.projects.length
    ? input.projects.map((p) => `${p.name} (${p.id})${p.sections.length ? ` — sections: ${p.sections.map((s) => `${s.name} (${s.id})`).join(", ")}` : ""}`).join("\n")
    : "(no projects)";
  return {
    feature: RAMBLE_FEATURE,
    subjectKind: "list",
    subject: `ramble:${rambleHash(input.transcript)}`,
    subjectVersion: input.subjectVersion,
    instructions: RAMBLE_INSTRUCTIONS,
    data: [
      { label: "context", text: `Today: ${input.today}\nNow: ${input.now}\nTime zone: ${input.tz}` },
      { label: "transcript", text: input.transcript.slice(0, MAX_TRANSCRIPT) },
      { label: "projects", text: projects },
      { label: "labels", text: input.labels.length ? input.labels.map((l) => `${l.name} (${l.id})`).join(", ") : "(none)" },
    ],
    schema: rambleSchema(input),
    schemaName: "ramble_tasks",
  };
}
