// The AI job runner (SPEC §4.9): one job at a time (a local model server often
// serves one request at a time), Cancel, schema validation with one retry, and
// results stored in `ai_results`. Jobs live in the server process; the UI polls.
//
// Suggest, never act: a job's result is text to show. Nothing here writes to
// GitHub or to tasks. With AI off, or before "Test connection" passed for the
// current settings, nothing is spawned or sent.
import { randomUUID } from "node:crypto";
import { readAiSettings, readAiVerified } from "../settings";
import { redactSecrets } from "../redact";
import { askModel } from "./provider";
import { buildPrompt, inputHash, jsonSchemaOf, type AiTask } from "./prompt";
import { saveResult } from "./results";
import { verifyId, type AiFailure, type AiSettings } from "./types";

export type JobState = "queued" | "running" | "done" | "error" | "cancelled";

export type Job = {
  id: string;
  feature: string;
  subject: string;
  state: JobState;
  createdAt: string;
  finishedAt: string | null;
  error: AiFailure | null;
  /** The `ai_results` row, once stored (null without a database). */
  resultId: string | null;
  /** The validated answer. */
  result: unknown;
  /** A batch's members share its id; the UI shows "n of N". */
  batchId: string | null;
  /** The provider and model this job was started with (null while off). */
  provider: string | null;
  model: string | null;
  /** When the job left the queue (null while queued). */
  startedAt: string | null;
  /** `createdAt` → run start, the time the user waited in the queue. */
  queueMs: number | null;
  /** Run start → finish, including a retry. */
  durationMs: number | null;
  /** Claude Code's own `duration_ms` and `duration_api_ms`, when it reports them. */
  providerMs: number | null;
  providerApiMs: number | null;
};

type Store = { jobs: Map<string, Job>; controllers: Map<string, AbortController>; tail: Promise<void> };
const STORE = Symbol.for("deska.aiJobs");
const KEEP_FINISHED = 100;

function store(): Store {
  const g = globalThis as Record<symbol, Store | undefined>;
  return (g[STORE] ??= { jobs: new Map(), controllers: new Map(), tail: Promise.resolve() });
}

const now = () => new Date().toISOString();

function prune(s: Store) {
  const finished = [...s.jobs.values()].filter((j) => j.state !== "queued" && j.state !== "running");
  for (const j of finished.slice(0, Math.max(0, finished.length - KEEP_FINISHED))) s.jobs.delete(j.id);
}

/** A copy for the page: no answer text beyond the validated result, and every message redacted. */
function snapshot(j: Job): Job {
  return { ...j, error: j.error ? { code: j.error.code, message: redactSecrets(j.error.message) } : null };
}

export function getJob(id: string): Job | null {
  const j = store().jobs.get(id);
  return j ? snapshot(j) : null;
}

/** Jobs that are queued or running, oldest first. */
export function activeJobs(): Job[] {
  return [...store().jobs.values()].filter((j) => j.state === "queued" || j.state === "running").map(snapshot);
}

/** Every job of one batch that is still in memory, oldest first. */
export function jobsOfBatch(batchId: string): Job[] {
  return [...store().jobs.values()].filter((j) => j.batchId === batchId).map(snapshot);
}

/** Cancels a queued or running job. A finished one is left as it is. */
export function cancelJob(id: string): Job | null {
  const s = store();
  const j = s.jobs.get(id);
  if (!j) return null;
  if (j.state === "queued") {
    j.state = "cancelled";
    j.finishedAt = now();
    j.error = { code: "cancelled", message: "Cancelled." };
  } else if (j.state === "running") {
    s.controllers.get(id)?.abort();
  }
  return snapshot(j);
}

/** Why AI may not run right now, or null. Checked before anything is spawned or sent. */
export async function aiNotReady(): Promise<{ settings: AiSettings; failure: AiFailure | null }> {
  const settings = await readAiSettings();
  if (settings.provider === "off") return { settings, failure: { code: "off", message: "AI assist is off. Choose a provider in Settings → AI." } };
  if ((await readAiVerified()) !== verifyId(settings)) return { settings, failure: { code: "not-verified", message: "Run \"Test connection\" in Settings → AI before using AI assist." } };
  return { settings, failure: null };
}

/** A short, value-free description of why an answer failed its schema, for the retry prompt. */
function describeIssues(issues: { path: PropertyKey[]; message: string }[]): string {
  return issues
    .slice(0, 5)
    .map((i) => `${i.path.length ? i.path.map(String).join(".") : "(root)"}: ${i.message}`)
    .join("; ");
}

async function execute(job: Job, task: AiTask, settings: AiSettings, signal: AbortSignal): Promise<void> {
  const started = Date.now();
  job.startedAt = now();
  job.queueMs = Math.max(0, started - Date.parse(job.createdAt));
  const schema = jsonSchemaOf(task);
  let retryError: string | undefined;
  let cost: number | null = null;
  const failure: AiFailure = { code: "invalid-output", message: "The model returned invalid output." };
  for (let attempt = 0; attempt < 2; attempt++) {
    const answer = await askModel(settings, {
      prompt: (o) => buildPrompt(task, settings.extraInstructions, { retryError, schemaInPrompt: o.schemaInPrompt }),
      schemaName: task.schemaName,
      schema,
      signal,
    });
    if (signal.aborted) {
      job.state = "cancelled";
      job.error = { code: "cancelled", message: "Cancelled." };
      return;
    }
    if (!answer.ok) {
      if (answer.code !== "invalid-output") {
        job.state = "error";
        job.error = { code: answer.code, message: answer.message };
        return;
      }
      retryError = answer.message;
      continue;
    }
    if (answer.costUsd !== null) cost = (cost ?? 0) + answer.costUsd;
    job.providerMs = answer.timings.durationMs;
    job.providerApiMs = answer.timings.apiMs;
    const parsed = task.schema.safeParse(answer.output);
    if (parsed.success) {
      job.result = parsed.data;
      // A feature may keep fields the model does not answer (e.g. the question
      // it was asked) next to the validated answer in the stored result.
      const stored = task.resultMeta ? { ...task.resultMeta, ...(parsed.data as Record<string, unknown>) } : parsed.data;
      job.resultId = await saveResult({
        feature: task.feature,
        subjectKind: task.subjectKind,
        subject: task.subject,
        inputHash: inputHash(task, settings.extraInstructions),
        provider: settings.provider,
        model: settings.model,
        result: stored,
        durationMs: Date.now() - started,
        costUsd: cost,
      });
      job.state = "done";
      return;
    }
    retryError = describeIssues(parsed.error.issues);
  }
  // Two invalid answers: nothing partial becomes a suggestion.
  job.state = "error";
  job.error = failure;
}

/**
 * Queues a job and returns at once; poll `getJob`. Fails (without queuing) when
 * AI is off or untested: nothing is spawned or sent then. When the readiness
 * check itself throws (the settings cannot be read), it rejects and nothing is
 * left behind in the job list.
 */
export async function startJob(task: AiTask, opts: { batchId?: string } = {}): Promise<Job> {
  return (await startJobs([task], opts))[0]!;
}

/**
 * Queues one job per task, all or nothing: readiness is checked once, before
 * any job exists, so a rejection leaves no job queued (and a batch whose start
 * failed has no members running behind the caller's back).
 */
export async function startJobs(tasks: AiTask[], opts: { batchId?: string } = {}): Promise<Job[]> {
  const ready = await aiNotReady();
  return tasks.map((task) => enqueue(task, ready, opts));
}

function enqueue(task: AiTask, { settings, failure }: Awaited<ReturnType<typeof aiNotReady>>, opts: { batchId?: string }): Job {
  const s = store();
  const job: Job = {
    id: randomUUID(),
    feature: task.feature,
    subject: task.subject,
    state: "queued",
    createdAt: now(),
    finishedAt: null,
    error: null,
    resultId: null,
    result: null,
    batchId: opts.batchId ?? null,
    provider: null,
    model: null,
    startedAt: null,
    queueMs: null,
    durationMs: null,
    providerMs: null,
    providerApiMs: null,
  };
  s.jobs.set(job.id, job);
  if (failure) {
    job.state = "error";
    job.error = failure;
    job.finishedAt = now();
    return snapshot(job);
  }
  job.provider = settings.provider;
  job.model = settings.model;
  const ctrl = new AbortController();
  s.controllers.set(job.id, ctrl);
  s.tail = s.tail.then(async () => {
    try {
      if (job.state !== "queued") return; // cancelled while waiting
      job.state = "running";
      await execute(job, task, settings, ctrl.signal);
    } catch (e) {
      job.state = "error";
      job.error = { code: "failed", message: e instanceof Error ? e.message : String(e) };
    } finally {
      job.finishedAt ??= now();
      if (job.startedAt) job.durationMs ??= Math.max(0, Date.parse(job.finishedAt) - Date.parse(job.startedAt));
      logJob(job);
      s.controllers.delete(job.id);
      prune(s);
    }
  });
  return snapshot(job);
}

/** One line per job that ran, with the queue and provider timings (item 6). Redacted. */
function logJob(job: Job): void {
  if (!job.startedAt) return;
  const parts = [`queued ${job.queueMs ?? 0} ms`, `ran ${job.durationMs ?? 0} ms`];
  if (job.providerMs != null) parts.push(`provider ${job.providerMs} ms`);
  if (job.providerApiMs != null) parts.push(`API ${job.providerApiMs} ms`);
  console.info(redactSecrets(`deska: AI ${job.feature} ${job.subject} ${job.state} — ${parts.join(", ")}${job.error ? ` (${job.error.code})` : ""}`));
}

/** Tests only: forget every job. */
export function resetJobs(): void {
  (globalThis as Record<symbol, unknown>)[STORE] = undefined;
}

/** Resolves when the queue is empty (tests). */
export function idle(): Promise<void> {
  return store().tail;
}
