// The request shapes of the project and mapping settings (D4).
import { z } from "zod";

const id = z.string().min(1).max(200);
const ref = z.object({ id, name: z.string().max(200) }).strict();

export const mappingSchema = z
  .object({
    status: ref.nullable(),
    priority: ref.nullable(),
    sprint: ref.nullable(),
    dimensions: z.array(ref).max(30),
    priorityOrder: z.enum(["highest-first", "lowest-first"]),
    doneStatusIds: z.array(id).max(50),
  })
  .strict();

export const targetSchema = z
  .object({
    repo: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, "must look like owner/repo"),
    org: z.string().regex(/^[A-Za-z0-9_.-]+$/, "must be an organization or user login"),
    projectNumber: z.number().int().positive(),
  })
  .strict();
