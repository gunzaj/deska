import { z } from "zod";
import { discoverProjects } from "@/lib/server/project-setup";
import { route } from "@/lib/server/route";

export const dynamic = "force-dynamic";

/** The org's projects the token can read (onboarding step 2). Read-only. */
export const GET = route({ auth: "viewer", query: z.object({ org: z.string().regex(/^[A-Za-z0-9_.-]+$/).max(100) }), invalid: "invalid organization or user" }, async ({ query }) => ({
  projects: await discoverProjects(query.org),
}));
