import { NextResponse } from "next/server";
import { route } from "@/lib/server/route";
import { createTaskSchema } from "@/lib/tasks/model";
import { assignable, fail, resolver, knownLogins, withHtml } from "@/lib/tasks/http";
import { accessFor, createTask, listTasks } from "@/lib/tasks/service";

export const dynamic = "force-dynamic";

// Tasks are Deska-native (SPEC §12): nothing here touches GitHub.

export const GET = route({ auth: "viewer" }, async ({ viewer }) => {
  const { tasks, projects, labels } = await listTasks(viewer);
  const people = new Set(await knownLogins());
  for (const t of tasks) {
    people.add(t.creator);
    if (t.assignee) people.add(t.assignee);
  }
  return { tasks, projects, labels, access: await accessFor(people, viewer) };
});

export const POST = route({ auth: "viewer", body: createTaskSchema, invalid: "invalid task" }, async ({ viewer, body: input }) => {
  const r = await createTask(viewer, input, input.assignee ? await assignable() : () => false, input.links.length ? await resolver() : undefined);
  return r.ok ? NextResponse.json(withHtml(r.value), { status: 201 }) : fail(r);
});
