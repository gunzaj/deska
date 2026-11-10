// Creating an issue (SPEC §4.8, W3): one outbox job that creates the issue on
// GitHub, adds it to the pinned project, sets the mapped fields and the Type,
// with the same gate and outbox as every other write. The form's fields are
// validated against the discovered metadata by ID, never by name.
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { dimFieldId, isDimKey } from "@/lib/sync/field-map";
import type { ReadModel } from "@/lib/sync/read-model";
import { depsFor } from "./runtime";
import { enqueueEdit, processEdit, type OutboxRow, type ProcessDeps } from "./store";

const id = z.string().min(1).max(200);

/** One mapped field the create form sets (Status, Priority, Sprint or a dimension). */
const fieldValue = z
  .object({
    field: z.union([z.enum(["status", "priority", "release"]), z.custom<`dim:${string}`>((v) => typeof v === "string" && v.length <= 120 && isDimKey(v), "unknown field")]),
    next: z.union([id, z.null()]),
  })
  .strict();

/** The create form's body. Title is required; everything else is optional (SPEC §4.8). */
export const createIssueSchema = z
  .object({
    title: z.string().trim().min(1).max(256),
    body: z.string().max(65_536).optional(),
    typeId: z.union([id, z.null()]).optional(),
    milestoneId: z.union([id, z.null()]).optional(),
    labelIds: z.array(id).max(50).optional(),
    assigneeLogins: z.array(z.string().min(1).max(100)).max(10).optional(),
    fields: z.array(fieldValue).max(20).optional(),
  })
  .strict();
export type CreateIssueBody = z.infer<typeof createIssueSchema>;

/** What the create job sends GitHub: the REST create payload plus the field writes. */
export type CreateIssuePayload = {
  title: string;
  body: string;
  /** Labels by name (the REST create takes names; the cache keys labels by ID). */
  labelNames: string[];
  assigneeLogins: string[];
  /** Milestone number, as the REST API takes it. */
  milestoneNumber: number | null;
  /** The issue Type's node ID; set with a GraphQL mutation after creation. */
  typeId: string | null;
  /** Mapped field values, applied through the project item after creation. */
  fields: { field: string; next: string | null }[];
};

export type CreateResult = { status: number; body: { entry?: OutboxRow; error?: string } };

const bad = (error: string): CreateResult => ({ status: 400, body: { error } });

/**
 * Validate the form against the discovered metadata (options, labels, assignees,
 * milestones and Type by ID), turn it into one outbox `create` job, store it and
 * process it now. A failure part-way is resumed by the worker from the step it
 * recorded, so the issue is never created twice (W3).
 */
export async function submitCreate(args: {
  viewer: string;
  token: string;
  store: ReadModel;
  body: CreateIssueBody;
  /** Tests inject a fake GitHub. */
  deps?: (doneStatusOptionId: string) => ProcessDeps;
}): Promise<CreateResult> {
  const { store, body } = args;
  const map = store.projectFieldMap();
  const title = body.title.trim();
  if (!title) return bad("a title is required");
  const payload: CreateIssuePayload = {
    title,
    body: body.body ?? "",
    labelNames: [],
    assigneeLogins: body.assigneeLogins ?? [],
    milestoneNumber: null,
    typeId: body.typeId ?? null,
    fields: [],
  };

  const labelIds = body.labelIds ?? [];
  const names = labelIds.map((l) => store.labels.get(l)?.name);
  if (names.some((n) => !n)) return bad("unknown label");
  payload.labelNames = names as string[];

  if (payload.assigneeLogins.length) {
    const known = new Set([...store.ghUsers.values()].map((u) => u.login.toLowerCase()));
    if (payload.assigneeLogins.some((l) => !known.has(l.toLowerCase()))) return bad("unknown assignee");
  }
  if (payload.typeId && !store.issueTypes.has(payload.typeId)) return bad(`unknown type: ${payload.typeId}`);
  if (body.milestoneId) {
    const m = store.milestones.get(body.milestoneId);
    if (!m) return bad(`unknown milestone: ${body.milestoneId}`);
    payload.milestoneNumber = m.number;
  }
  for (const f of body.fields ?? []) {
    const ok = (() => {
      if (isDimKey(f.field)) {
        const ref = map.dimensions.find((d) => d.id === dimFieldId(f.field));
        return !!ref && !!store.fields.get(ref.id)?.options.some((o) => o.id === f.next);
      }
      if (f.field === "status" || f.field === "priority") {
        const ref = map[f.field];
        return !!ref && !!store.fields.get(ref.id)?.options.some((o) => o.id === f.next);
      }
      return !!map.sprint && !!store.fields.get(map.sprint.id)?.iterations.some((i) => i.id === f.next);
    })();
    if (!ok) return bad(`unknown ${f.field}: ${String(f.next)}`);
    payload.fields.push({ field: f.field, next: f.next });
  }

  const entry = await enqueueEdit({
    userId: args.viewer.toLowerCase(),
    // No issue exists yet: the create job's `result` carries the node ID it made.
    issueNodeId: "",
    op: "create",
    field: null,
    base: null,
    next: payload,
    // Namespaced per user: one user's key can never return another's job.
    idempotencyKey: `${args.viewer.toLowerCase()}:${randomUUID()}`,
  });
  const deps = args.deps ? args.deps("") : await depsFor(args.token, "", map);
  const after = (await processEdit(entry.id, deps)) ?? entry;
  const code = after.status === "done" ? 201 : after.status === "conflict" ? 409 : after.status === "failed" ? 502 : 202;
  return { status: code, body: { entry: after } };
}
