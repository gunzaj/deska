// The PR lens's view state (SPEC §13.3): filters, sort, grouping, layout.
// Saved views store it under `pr` with `entity: "pr"`.
import { z } from "zod";

const values = z.array(z.string().max(100)).max(50);

export const prFilterSchema = z.union([
  z.object({ field: z.literal("state"), values: z.array(z.enum(["open", "draft", "merged", "closed"])) }),
  z.object({ field: z.enum(["author", "requested", "reviewedBy", "decision", "checks", "label", "milestone", "assignee"]), values }),
  z.object({ field: z.literal("linked"), values: z.array(z.enum(["yes", "no"])) }),
  z.object({ field: z.literal("text"), value: z.string().max(200) }),
]);

export const prViewStateSchema = z.object({
  filters: z.array(prFilterSchema).max(30),
  sort: z.enum(["updated", "created", "number"]),
  dir: z.enum(["asc", "desc"]),
  groupBy: z.enum(["", "author", "decision", "checks", "label", "state"]),
  layout: z.enum(["list", "table"]),
});

export type PrFilter = z.infer<typeof prFilterSchema>;
export type PrViewState = z.infer<typeof prViewStateSchema>;
export type PrFilterField = Exclude<PrFilter["field"], "text">;
