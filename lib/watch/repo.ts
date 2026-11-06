// Watchlist (IMPROVEMENTS F6): personal, kept in Deska only. Postgres in
// production; a process-local map without a database (dev and tests).
import { and, eq } from "drizzle-orm";
import { dbDir, getDb } from "@/db";
import { watches } from "@/db/schema";

export type WatchKind = "issue" | "view";
export type Watch = { kind: WatchKind; targetId: string; lastSeenAt: string };

export const isWatchKind = (v: unknown): v is WatchKind => v === "issue" || v === "view";

const g = globalThis as unknown as { __watches?: Map<string, Map<string, Watch>> };
const memory = () => (g.__watches ??= new Map());
const keyOf = (kind: WatchKind, targetId: string) => `${kind}:${targetId}`;
const norm = (login: string) => login.toLowerCase();

export async function listWatches(login: string): Promise<Watch[]> {
  const who = norm(login);
  if (!dbDir()) return [...(memory().get(who)?.values() ?? [])].sort((a, b) => a.targetId.localeCompare(b.targetId));
  const rows = await getDb().select().from(watches).where(eq(watches.login, who));
  return rows.map((r) => ({ kind: r.kind as WatchKind, targetId: r.targetId, lastSeenAt: r.lastSeenAt.toISOString() }));
}

/** Start watching: "seen" from now. Watching again keeps the old last-seen time. */
export async function addWatch(login: string, kind: WatchKind, targetId: string, now = new Date()): Promise<Watch> {
  const who = norm(login);
  if (!dbDir()) {
    const m = memory().get(who) ?? new Map<string, Watch>();
    const k = keyOf(kind, targetId);
    const w = m.get(k) ?? { kind, targetId, lastSeenAt: now.toISOString() };
    m.set(k, w);
    memory().set(who, m);
    return w;
  }
  await getDb().insert(watches).values({ login: who, kind, targetId, lastSeenAt: now }).onConflictDoNothing();
  const row = (await getDb().select().from(watches).where(and(eq(watches.login, who), eq(watches.kind, kind), eq(watches.targetId, targetId))))[0]!;
  return { kind, targetId, lastSeenAt: row.lastSeenAt.toISOString() };
}

export async function removeWatch(login: string, kind: WatchKind, targetId: string): Promise<void> {
  const who = norm(login);
  if (!dbDir()) {
    memory().get(who)?.delete(keyOf(kind, targetId));
    return;
  }
  await getDb().delete(watches).where(and(eq(watches.login, who), eq(watches.kind, kind), eq(watches.targetId, targetId)));
}

/** The person looked at it: what changed before now is no longer news. False when it isn't watched. */
export async function markSeen(login: string, kind: WatchKind, targetId: string, now = new Date()): Promise<Watch | null> {
  const who = norm(login);
  if (!dbDir()) {
    const w = memory().get(who)?.get(keyOf(kind, targetId));
    if (!w) return null;
    w.lastSeenAt = now.toISOString();
    return w;
  }
  const rows = await getDb()
    .update(watches)
    .set({ lastSeenAt: now })
    .where(and(eq(watches.login, who), eq(watches.kind, kind), eq(watches.targetId, targetId)))
    .returning();
  return rows[0] ? { kind, targetId, lastSeenAt: rows[0].lastSeenAt.toISOString() } : null;
}
