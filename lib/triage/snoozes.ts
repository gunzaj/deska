// Triage snoozes (IMPROVEMENTS F3): personal, kept in Deska only. Postgres in
// production; a process-local map without a database (dev and tests).
import { and, eq } from "drizzle-orm";
import { dbDir, getDb } from "@/db";
import { triageSnoozes } from "@/db/schema";
import { isIsoDate } from "@/lib/tasks/dates";

export type Snooze = { nodeId: string; until: string };

export { isIsoDate };

// One map for the process, surviving dev hot reloads.
const g = globalThis as unknown as { __triageSnoozes?: Map<string, Map<string, string>> };
const memory = () => (g.__triageSnoozes ??= new Map());

const norm = (login: string) => login.toLowerCase();

/** The login's snoozes. Expired ones are the caller's to ignore; retention deletes them. */
export async function listSnoozes(login: string): Promise<Snooze[]> {
  const who = norm(login);
  if (!dbDir()) return [...(memory().get(who) ?? [])].map(([nodeId, until]) => ({ nodeId, until }));
  const rows = await getDb().select({ nodeId: triageSnoozes.issueNodeId, until: triageSnoozes.until }).from(triageSnoozes).where(eq(triageSnoozes.login, who));
  return rows;
}

export async function setSnooze(login: string, nodeId: string, until: string): Promise<void> {
  const who = norm(login);
  if (!dbDir()) {
    const m = memory().get(who) ?? new Map<string, string>();
    m.set(nodeId, until);
    memory().set(who, m);
    return;
  }
  await getDb()
    .insert(triageSnoozes)
    .values({ login: who, issueNodeId: nodeId, until })
    .onConflictDoUpdate({ target: [triageSnoozes.login, triageSnoozes.issueNodeId], set: { until } });
}

export async function clearSnooze(login: string, nodeId: string): Promise<void> {
  const who = norm(login);
  if (!dbDir()) {
    memory().get(who)?.delete(nodeId);
    return;
  }
  await getDb().delete(triageSnoozes).where(and(eq(triageSnoozes.login, who), eq(triageSnoozes.issueNodeId, nodeId)));
}
