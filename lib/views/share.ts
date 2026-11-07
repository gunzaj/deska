// Copy / Import view (SPEC §4.2): a saved view as a compact JSON string that
// can be pasted into another install. Field and option IDs travel inside it,
// so it only means something to a project that has the same fields. Pure and
// client-safe. Pasted text is untrusted: it goes through the same strict schema
// (and limits) as any saved view, and the ID is never taken from it.
import { viewSchema, type View } from "./view";

/** Marks a string as a Deska view, so unrelated JSON is refused with a clear reason. */
const KIND = "deska-view";
const VERSION = 1;

/** The view string Copy puts on the clipboard. Name, layout, filters, sort, grouping, board column, columns. */
export function encodeView(view: View): string {
  const { id: _id, ...rest } = view;
  return JSON.stringify({ kind: KIND, v: VERSION, view: rest });
}

export type ImportedView = Omit<View, "id">;
export type DecodeResult = { ok: true; view: ImportedView } | { ok: false; error: string };

export function decodeView(text: string): DecodeResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text.trim());
  } catch {
    return { ok: false, error: "That isn't a Deska view. Copy one with “Copy view”." };
  }
  const o = raw as { kind?: unknown; v?: unknown; view?: unknown } | null;
  if (!o || typeof o !== "object" || o.kind !== KIND) return { ok: false, error: "That isn't a Deska view. Copy one with “Copy view”." };
  if (o.v !== VERSION) return { ok: false, error: "This view comes from a different version of Deska." };
  const parsed = viewSchema.safeParse({ ...(o.view as object), id: "import" });
  if (!parsed.success) return { ok: false, error: "This view is damaged or uses fields this version doesn't know." };
  const { id: _id, ...view } = parsed.data;
  if (!view.name.trim()) return { ok: false, error: "This view has no name." };
  return { ok: true, view };
}
