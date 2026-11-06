// Shared SQL and transaction helpers for the batched Postgres writes (v5 4.5).
import * as schema from "@/db/schema";
import { getTableColumns, inArray, sql, type SQL } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { issues, issueFieldChanges } from "@/db/schema";
import type { ChangeSource, ImportOptions, TrackedField } from "../changes";
import type { StoreStats } from "../import";

export const PAGE_SIZE = 100;

/**
 * Field change history (F0). `fresh` holds the node IDs of issues first seen
 * in this import: they are new, so what they carry now is not a change.
 */
export type Ctx = { source: ChangeSource; fresh: Set<string> };
export const newCtx = (opts?: ImportOptions): Ctx => ({ source: opts?.source ?? "sync", fresh: new Set() });
export type ChangeRow = { issueId: string; field: TrackedField; oldValue: string | null; newValue: string | null };

export async function recordChanges(tx: Tx, rows: ChangeRow[], source: ChangeSource) {
  if (!rows.length) return;
  await tx.insert(issueFieldChanges).values(rows.map((r) => ({ ...r, source })));
}

export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type Result = "inserted" | "updated" | "unchanged";

export const emptyStats = (): StoreStats => ({ inserted: 0, updated: 0, unchanged: 0 });
export function add(stats: StoreStats, more: StoreStats) {
  stats.inserted += more.inserted;
  stats.updated += more.updated;
  stats.unchanged += more.unchanged;
}

export function pages<T>(rows: T[], size = PAGE_SIZE): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

/** One row per key, the last occurrence winning (REST paging can repeat a row). */
export function lastByKey<T>(rows: T[], key: (r: T) => string): T[] {
  const m = new Map<string, T>();
  for (const r of rows) {
    const k = key(r);
    m.delete(k);
    m.set(k, r);
  }
  return [...m.values()];
}

/** SQL column name of a Drizzle table property. */
export function col(table: PgTable, prop: string): string {
  const c = (getTableColumns(table) as Record<string, PgColumn>)[prop];
  if (!c) throw new Error(`unknown column ${prop}`);
  return c.name;
}

/** `{ prop: excluded.col }` for an ON CONFLICT DO UPDATE. */
export function excludedSet(table: PgTable, props: string[]): Record<string, SQL> {
  return Object.fromEntries(props.map((p) => [p, sql.raw(`excluded."${col(table, p)}"`)]));
}

/** `(t.a, t.b) IS DISTINCT FROM (excluded.a, excluded.b)`: update only real changes. */
export function changed(table: PgTable, props: string[]): SQL {
  const cols = getTableColumns(table) as Record<string, PgColumn>;
  const mine = sql.join(
    props.map((p) => cols[p]!),
    sql`, `,
  );
  const theirs = sql.raw(props.map((p) => `excluded."${col(table, p)}"`).join(", "));
  return sql`(${mine}) IS DISTINCT FROM (${theirs})`;
}

/**
 * Never let an older payload overwrite a newer row (v5 2.1). A scan page
 * fetched before an edit can commit after the post-write refresh; without this
 * it reverted the field until the next scan, and the user's next edit then
 * compared against the stale value and reported a false conflict.
 */
export function notOlder(table: PgTable): SQL {
  const updatedAt = (getTableColumns(table) as Record<string, PgColumn>).updatedAt!;
  return sql`(${updatedAt} IS NULL OR excluded."updated_at" IS NULL OR excluded."updated_at" >= ${updatedAt})`;
}

export const insertedFlag = sql<boolean>`(xmax = 0)`;

/** Tally an upsert's RETURNING rows: returned = inserted or updated, rest unchanged. */
export function tallyUpsert(total: number, returned: { inserted: boolean }[]): StoreStats {
  const inserted = returned.filter((r) => r.inserted).length;
  return { inserted, updated: returned.length - inserted, unchanged: total - returned.length };
}


export async function uuidsOf(tx: Tx, nodeIds: string[]): Promise<Map<string, string>> {
  if (!nodeIds.length) return new Map();
  const rows = await tx.select({ id: issues.id, nodeId: issues.ghNodeId }).from(issues).where(inArray(issues.ghNodeId, [...new Set(nodeIds)]));
  return new Map(rows.map((r) => [r.nodeId!, r.id]));
}

/**
 * Make each owner's child set equal `want`, touching only the differences.
 * Returns which owners changed.
 */
export async function diffChildren<T extends Record<string, unknown>>(
  tx: Tx,
  table: PgTable,
  ownerProp: string,
  keyProps: string[],
  owners: string[],
  want: T[],
  /** F0: filled with each touched owner's old and new values of `valueProp`. */
  changes?: { valueProp: string; into: Map<string, { old: string[]; new: string[] }> },
): Promise<Set<string>> {
  const touched = new Set<string>();
  if (!owners.length) return touched;
  const cols = getTableColumns(table) as Record<string, PgColumn>;
  const allProps = Object.keys(cols);
  const key = (r: Record<string, unknown>) => JSON.stringify(allProps.map((p) => normalize(r[p])));
  const current = (await tx.select().from(table).where(inArray(cols[ownerProp]!, owners))) as Record<string, unknown>[];
  const have = new Map(current.map((r) => [key(r), r]));
  const wanted = new Map(want.map((r) => [key(r), r]));
  const gone = current.filter((r) => !wanted.has(key(r)));
  const fresh = want.filter((r) => !have.has(key(r)));
  if (gone.length) {
    const match = sql.join(
      gone.map((r) => sql`(${sql.join(keyProps.map((p) => sql`${cols[p]!} = ${r[p]}`), sql` AND `)})`),
      sql` OR `,
    );
    await tx.delete(table).where(match);
    for (const r of gone) touched.add(String(r[ownerProp]));
  }
  if (fresh.length) {
    await tx.insert(table).values(fresh as never).onConflictDoNothing();
    for (const r of fresh) touched.add(String(r[ownerProp]));
  }
  if (changes) {
    const values = (rows: Record<string, unknown>[], owner: string) => rows.filter((r) => String(r[ownerProp]) === owner).map((r) => String(r[changes.valueProp]));
    for (const owner of touched) changes.into.set(owner, { old: values(current, owner), new: values(want as Record<string, unknown>[], owner) });
  }
  return touched;
}

/** Comparable form of a column value (Dates from the DB vs ISO strings). */
export function normalize(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString();
  return v ?? null;
}
