import { z } from "zod";
import { route } from "@/lib/server/route";
import { searchTasks } from "@/lib/tasks/service";

export const dynamic = "force-dynamic";

// ⌘K task search (SPEC §4.6, D13): title, description and comments.
export const GET = route({ auth: "viewer", query: z.object({ q: z.string().max(200) }), invalid: "invalid search" }, ({ owner, query }) => searchTasks(owner, query.q));
