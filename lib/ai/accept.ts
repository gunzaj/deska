// Accepting an AI suggestion (SPEC §4.9, W1): the model only suggests, and
// accepting a GitHub change goes through the §3.4 gate and the §4.8 outbox like
// a manual edit. Nothing here is applied without the user's Accept.
import { localToken } from "@/lib/github/local-token";
import { dimFieldId } from "@/lib/sync/field-map";
import { submitEdit, type EditField } from "@/lib/outbox/edit";
import { HttpError } from "@/lib/server/route";
import { getViewerLogin } from "@/lib/session";
import { getStore } from "@/lib/store";
import type { ProcessDeps } from "@/lib/outbox/store";
import type { TriageSuggestion } from "./triage";

/** Which parts of a suggestion to apply; default is all of them. */
export type SuggestionPart = "status" | "priority" | "dimension" | "sprint" | "labels";
export const SUGGESTION_PARTS: readonly SuggestionPart[] = ["status", "priority", "dimension", "sprint", "labels"];

export type AcceptedSuggestion = {
  /** The fields written, in the order they were applied. */
  applied: SuggestionPart[];
  /** The suggested parts that matched what the issue already had (nothing to write). */
  unchanged: SuggestionPart[];
};

/**
 * Apply a stored triage suggestion to its issue through the outbox. Each changed
 * field is one write with the cache's value as the stale check base, so a change
 * on GitHub since the suggestion was made is reported as a conflict. Labels are a
 * delta: the suggested labels are added, and none are removed.
 */
export async function acceptTriageSuggestion(
  row: { subject: string; result: unknown },
  opts: { parts?: SuggestionPart[]; deps?: (doneStatusOptionId: string) => ProcessDeps } = {},
): Promise<AcceptedSuggestion> {
  const number = Number(row.subject);
  if (!Number.isInteger(number)) throw new HttpError(422, "The suggestion is not about an issue.");
  const store = await getStore();
  const issue = store.issueByNumber(number);
  if (!issue) throw new HttpError(404, "That issue is not in the Deska cache.");
  const token = localToken();
  if (!token) throw new HttpError(401, "GitHub is not connected");
  const viewer = await getViewerLogin();
  if (!viewer) throw new HttpError(401, "GitHub is not connected");
  const result = (row.result ?? {}) as TriageSuggestion;
  const wanted = new Set<SuggestionPart>(opts.parts ?? SUGGESTION_PARTS);
  const map = store.projectFieldMap();
  const item = store.itemForIssue(issue.nodeId);
  const edits: { part: SuggestionPart; field: EditField; next: unknown }[] = [];

  const field = (part: SuggestionPart, role: "status" | "priority" | "dimension" | "sprint", current: string | null, suggested: { id?: string } | null | undefined) => {
    if (!wanted.has(part) || !suggested?.id || suggested.id === current) return;
    if (role === "dimension") {
      const dim = map.dimensions[0];
      if (!dim) return;
      edits.push({ part, field: `dim:${dim.id}`, next: suggested.id });
      return;
    }
    if (role === "sprint") {
      if (!map.sprint) return;
      edits.push({ part, field: "release", next: suggested.id });
      return;
    }
    if (!map[role]) return;
    edits.push({ part, field: role, next: suggested.id });
  };

  field("status", "status", item?.statusOpt ?? null, result.status);
  field("priority", "priority", item?.priorityOpt ?? null, result.priority);
  field("dimension", "dimension", map.dimensions[0] ? (item?.dims?.[dimFieldId(`dim:${map.dimensions[0].id}`)] ?? null) : null, result.dimension);
  field("sprint", "sprint", item?.releaseIter ?? null, result.sprint);
  if (wanted.has("labels") && result.labels?.length) {
    const have = new Set(issue.labelIds);
    const added = result.labels.map((l) => l.id).filter((id) => !have.has(id));
    if (added.length) edits.push({ part: "labels", field: "labels", next: { added, removed: [] } });
  }

  const applied: SuggestionPart[] = [];
  const unchanged = SUGGESTION_PARTS.filter((p) => wanted.has(p) && !edits.some((e) => e.part === p));
  for (const e of edits) {
    const r = await submitEdit({
      viewer,
      token,
      store,
      issueNodeId: issue.nodeId,
      body: { field: e.field, next: e.next, idempotencyKey: `ai-${e.part}-${Date.now()}-${Math.random().toString(36).slice(2)}` },
      deps: opts.deps,
    });
    if (r.status === 200) applied.push(e.part);
    else throw new HttpError(r.status === 409 ? 409 : 502, r.body.entry?.error ?? r.body.error ?? "The suggestion could not be applied.");
  }
  return { applied, unchanged };
}
