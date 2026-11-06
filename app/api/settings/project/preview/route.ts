import { z } from "zod";
import { previewProject } from "@/lib/server/project-setup";
import { route } from "@/lib/server/route";

export const dynamic = "force-dynamic";

/** One project's fields, live from GitHub, with a suggested mapping. Read-only; stores nothing. */
export const GET = route(
  {
    auth: "viewer",
    query: z.object({
      repo: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
      org: z.string().regex(/^[A-Za-z0-9_.-]+$/).max(100),
      number: z.coerce.number().int().positive(),
    }),
    invalid: "invalid project",
  },
  async ({ query }) => previewProject(query.repo, query.org, query.number),
);
