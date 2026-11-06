// One edit to one issue (W1): validation against the discovered metadata,
// the durable outbox, and the fast path. Shared by POST
// /api/issues/[number]/edit and the board's POST /api/issues/edit.
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { dimFieldId, isDimKey } from "@/lib/sync/field-map";
import type { ReadModel } from "@/lib/sync/read-model";
import { doneStatusOption, depsFor } from "./runtime";
import { enqueueEdit, processEdit, type OutboxRow, type ProcessDeps } from "./store";

export const EDIT_FIELDS = ["status", "priority", "release", "type", "milestone", "labels", "assignees", "state"] as const;
/** A fixed field, or a mapped dimension as `dim:<fieldId>` (§4.1). */
export type EditField = (typeof EDIT_FIELDS)[number] | `dim:${string}`;

/** `dim:<fieldId>`, the key of a dimension in edits, filters and grouping. */
export const dimKeySchema = z.custom<`dim:${string}`>((v) => typeof v === "string" && v.length <= 120 && isDimKey(v), "unknown field");

const id = z.string().min(1).max(200);
const delta = z.object({ added: z.array(id).max(50), removed: z.array(id).max(50) }).strict();

export const editSchema = z
  .object({
    field: z.union([z.enum(EDIT_FIELDS), dimKeySchema]),
    /** The value the client saw; GitHub must still hold it (not for deltas). */
    base: z.union([z.string().max(200), z.null()]).optional(),
    next: z.unknown(),
    /** Per user action; a retried request with the same key is the same edit. */
    idempotencyKey: z.string().min(8).max(100).optional(),
  })
  .strict();
export type EditBody = z.infer<typeof editSchema>;


export type EditResult = { status: number; body: { entry?: OutboxRow; error?: string } };

const bad = (error: string): EditResult => ({ status: 400, body: { error } });

/** The issue's value for `field` in the cache: the base when the client sends none. */
function cachedValue(store: ReadModel, nodeId: string, field: EditField): unknown {
  const issue = store.issues.get(nodeId);
  const item = store.itemForIssue(nodeId);
  if (isDimKey(field)) return item?.dims?.[dimFieldId(field)] ?? null;
  switch (field) {
    case "status":
      return item?.statusOpt ?? null;
    case "priority":
      return item?.priorityOpt ?? null;
    case "release":
      return item?.releaseIter ?? null;
    case "type":
      return issue?.typeId ?? null;
    case "milestone":
      return issue?.milestoneId ?? null;
    case "state":
      return issue?.state.toLowerCase() ?? null;
    default:
      return null;
  }
}

/**
 * Validate `next` against what Deska knows (options and iterations by ID,
 * never by name), turn it into an outbox edit, store it, and process it now.
 */
export async function submitEdit(args: {
  viewer: string;
  token: string;
  store: ReadModel;
  issueNodeId: string;
  body: EditBody;
  /** Tests inject a fake GitHub. */
  deps?: (doneStatusOptionId: string) => ProcessDeps;
}): Promise<EditResult> {
  const { store, issueNodeId, body } = args;
  const field = body.field;
  let op: "update" | "close" | "reopen" = "update";
  let next: unknown = body.next;
  let base: unknown = body.base === undefined ? cachedValue(store, issueNodeId, field) : body.base;
  let done = "";

  if (field === "state") {
    if (next !== "open" && next !== "closed") return bad("state must be open or closed");
    op = next === "closed" ? "close" : "reopen";
    if (op === "close") {
      // Nothing is written unless closing can also move Status to the agreed option.
      const d = doneStatusOption(store);
      if (!d.ok) return { status: 422, body: { error: d.reason } };
      done = d.id;
    }
  } else if (field === "labels" || field === "assignees") {
    const parsed = delta.safeParse(next);
    if (!parsed.success) return bad(`${field} take { added, removed }`);
    base = null;
    if (field === "labels") {
      // GitHub's REST label endpoints work by name; Deska keys labels by ID.
      const names = (ids: string[]) => ids.map((l) => store.labels.get(l)?.name);
      const added = names(parsed.data.added);
      const removed = names(parsed.data.removed);
      if ([...added, ...removed].some((n) => !n)) return bad("unknown label");
      next = { added, removed };
    } else {
      const known = new Set([...store.ghUsers.values()].map((u) => u.login.toLowerCase()));
      if ([...parsed.data.added, ...parsed.data.removed].some((l) => !known.has(l.toLowerCase()))) return bad("unknown assignee");
      next = parsed.data;
    }
  } else {
    if (next !== null && typeof next !== "string") return bad(`${field} takes an ID or null`);
    if (next !== null) {
      const ok = (() => {
        const map = store.projectFieldMap();
        if (isDimKey(field)) {
          const ref = map.dimensions.find((d) => d.id === dimFieldId(field));
          return !!ref && !!store.fields.get(ref.id)?.options.some((o) => o.id === next);
        }
        if (field === "status" || field === "priority") {
          const ref = map[field];
          return !!ref && !!store.fields.get(ref.id)?.options.some((o) => o.id === next);
        }
        if (field === "release") return !!map.sprint && !!store.fields.get(map.sprint.id)?.iterations.some((i) => i.id === next);
        if (field === "type") return store.issueTypes.has(next as string);
        if (field === "milestone") return store.milestones.has(next as string);
        return false;
      })();
      if (!ok) return bad(`unknown ${field}: ${String(next)}`);
    }
  }

  const entry = await enqueueEdit({
    userId: args.viewer.toLowerCase(),
    issueNodeId,
    op,
    field: op === "update" ? field : null,
    base,
    next,
    // Namespaced per user: one user's key can never return another's edit.
    idempotencyKey: `${args.viewer.toLowerCase()}:${body.idempotencyKey ?? randomUUID()}`,
  });
  const deps = args.deps ? args.deps(done) : await depsFor(args.token, done, store.projectFieldMap());
  const after = (await processEdit(entry.id, deps)) ?? entry;
  const code = after.status === "done" ? 200 : after.status === "conflict" ? 409 : after.status === "failed" ? 502 : 202;
  return { status: code, body: { entry: after } };
}
