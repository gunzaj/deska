import { z } from "zod";
import { isDimKey } from "../sync/field-map";

/**
 * Limits on a saved view (v5 2.6), in line with the task schemas
 * (lib/tasks/model.ts). Views are local, but an imported view string is
 * untrusted input: it must not be able to save a multi-megabyte name or 100k
 * filter values.
 */
export const VIEW_LIMITS = { name: 120, filters: 50, anyFilters: 20, values: 200, value: 100, text: 200, sort: 10, columns: 40, key: 40, id: 100 } as const;

const values = z.array(z.string().max(VIEW_LIMITS.value)).max(VIEW_LIMITS.values).optional();

/** A mapped dimension, by field ID: `dim:<fieldId>` (§4.1). Field and option IDs travel inside a view. */
export const dimKey = z.custom<`dim:${string}`>((v) => typeof v === "string" && v.length <= VIEW_LIMITS.id + 4 && isDimKey(v), "unknown dimension");

const leafFilterSchema = z.union([
  z.object({ field: z.enum(["assignee"]), op: z.enum(["in", "not_in", "empty"]), values }).strict(),
  z
    .object({
      field: z.enum(["status", "priority", "type", "label", "milestone"]),
      op: z.enum(["in", "not_in", "empty"]),
      values,
    })
    .strict(),
  z
    .object({
      field: z.literal("release"),
      op: z.enum(["in", "not_in", "empty"]),
      values,
    })
    .strict(),
  z.object({ field: dimKey, op: z.enum(["in", "not_in", "empty"]), values }).strict(),
  z.object({ field: z.literal("parent"), op: z.enum(["in", "empty", "has_sub_issues"]), values }).strict(),
  z.object({ field: z.literal("state"), op: z.enum(["in"]), values: z.array(z.enum(["open", "closed"])).max(2) }).strict(),
  z.object({ field: z.literal("text"), op: z.literal("contains"), value: z.string().max(VIEW_LIMITS.text) }).strict(),
  // Relative dates, resolved when the view runs (like "me" and "current").
  z
    .object({
      field: z.enum(["created", "updated", "closed"]),
      op: z.enum(["within_days", "older_than_days"]),
      days: z.number().int().positive().max(3650),
    })
    .strict(),
]);

type LeafFilter = z.infer<typeof leafFilterSchema>;
/** `any` matches when at least one nested filter matches (one level of OR). */
export type AnyFilter = { field: "any"; filters: LeafFilter[] };

export const filterSchema: z.ZodType<LeafFilter | AnyFilter> = z.union([
  leafFilterSchema,
  z.object({ field: z.literal("any"), filters: z.array(leafFilterSchema).min(1).max(VIEW_LIMITS.anyFilters) }).strict(),
]);

export const viewSchema = z
  .object({
    id: z.string().max(VIEW_LIMITS.id),
    name: z.string().max(VIEW_LIMITS.name),
    layout: z.enum(["list", "board", "table"]),
    filters: z.array(filterSchema).max(VIEW_LIMITS.filters),
    sort: z.array(z.object({ field: z.string().max(VIEW_LIMITS.id + 4), dir: z.enum(["asc", "desc"]) }).strict()).max(VIEW_LIMITS.sort),
    groupBy: z.string().max(VIEW_LIMITS.id + 4).optional(),
    boardColumnsField: z.union([z.enum(["status", "priority", "assignee", "release", "type"]), dimKey]).optional(),
    columns: z.array(z.string().max(VIEW_LIMITS.id + 4)).max(VIEW_LIMITS.columns).optional(),
  })
  .strict();

export type View = z.infer<typeof viewSchema>;
export type Filter = z.infer<typeof filterSchema>;
