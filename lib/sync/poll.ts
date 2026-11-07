// M3 incremental polling behind a SyncSource interface (SPEC §3).
// Webhook handler can implement SyncSource later.
import { partialSnapshot, type SnapshotIssue, type SnapshotProjectItem } from "./types";
import { importFull, type ImportStore, type MaybePromise } from "./import";

export type ChangeCheck =
  | { kind: "changed"; issues: SnapshotIssue[]; items: SnapshotProjectItem[]; etag: string; since: string }
  | { kind: "not-modified" }
  | { kind: "rate-limited"; retryAfterMs: number };

export interface SyncSource {
  checkChanges(since: string | null, etag: string | null): Promise<ChangeCheck>;
}

export interface Kv {
  get(key: string): string | null;
  set(key: string, value: string): void;
  /** Persist queued writes now (a checkpoint that must survive a cut-off run). */
  flush?(): Promise<void>;
}

/**
 * Maps the identities GitHub reports by name/login/number onto the IDs our
 * store keys on. Implemented by the stores; injected into the source so an
 * incremental poll can express labels, assignees and milestones instead of
 * having to blank them out.
 */
export interface IdResolver {
  /** Stable ID for a label name, creating a provisional entry if unseen. */
  labelId(name: string): MaybePromise<string>;
  /** Stable ID for a GitHub login, creating a provisional entry if unseen. */
  userId(login: string): MaybePromise<string>;
  /** Stable ID for a milestone number, or null when unknown. */
  milestoneId(number: number): MaybePromise<string | null>;
}

export type PollResult =
  | { applied: true; inserted: number; updated: number }
  | { applied: false; reason: "not-modified" | "rate-limited" | "needs-initial-import" };

/** One issue-poll cycle. 304 / rate-limit never touches the store. */
export async function pollOnce(
  source: SyncSource,
  store: ImportStore,
  kv: Kv,
  nowIso: string,
): Promise<PollResult> {
  const since = kv.get("issues.since");
  // No cursor means no initial import yet (lib/sync/initial.ts). A poll from
  // null pages the repo's whole history with state=all, which times out on
  // serverless and, never advancing the cursor, repeats on every tick.
  if (!since) return { applied: false, reason: "needs-initial-import" };
  const checked = await source.checkChanges(since, kv.get("issues.etag"));
  if (checked.kind === "not-modified") {
    // Still a successful cycle: record it so the UI does not show a stale
    // "last synced" time just because GitHub answered 304.
    kv.set("sync.lastSync", nowIso);
    return { applied: false, reason: "not-modified" };
  }
  if (checked.kind === "rate-limited") {
    kv.set("sync.rateLimitedUntil", String(Date.now() + checked.retryAfterMs));
    return { applied: false, reason: "rate-limited" };
  }
  const snapshot = partialSnapshot({ issues: checked.issues, projectItems: checked.items });
  const stats = await importFull(snapshot, store);
  kv.set("issues.since", checked.since || nowIso);
  kv.set("issues.etag", checked.etag);
  kv.set("sync.lastSync", nowIso);
  kv.set("sync.rateLimitedUntil", "0");
  return { applied: true, inserted: stats.inserted, updated: stats.updated };
}

export function isRateLimited(kv: Kv, nowMs = Date.now()): boolean {
  const until = Number(kv.get("sync.rateLimitedUntil") ?? 0);
  return Number.isFinite(until) && until > nowMs;
}

export class MapKv implements Kv {
  private m = new Map<string, string>();
  get(k: string) {
    return this.m.get(k) ?? null;
  }
  set(k: string, v: string) {
    this.m.set(k, v);
  }
}
