// What changed on a person's watched items since they last looked (F6).
import { listFieldChanges } from "@/lib/server/changes";
import { localToday } from "@/lib/tasks/dates";
import { getPrefs } from "@/lib/tasks/service";
import { getStore } from "@/lib/store";
import { runView } from "@/lib/views/engine";
import { buildViewRows } from "@/lib/views/rows";
import { viewsFor } from "@/lib/views/runtime";
import { parseSetValue, setValue, type FieldChange } from "@/lib/sync/changes";
import { isWatchKind, listWatches, type Watch, type WatchKind } from "./repo";

export const MAX_IDS = 2000;
export type WatchQuery = { kind?: unknown; targetId?: unknown };

const keyOf = (kind: WatchKind, targetId: string) => `${kind}:${targetId}`;

/**
 * The issues a watch covers, computed on the server: the issue itself, or the
 * issues a watched view matches. The browser never supplies this set, so a watcher
 * can only read change history for the items they actually watch.
 */
/** `owner` keys the local views; `meLogin` is the GitHub login a view's `me` means. */
export async function watchCoverage(owner: string, watches: Watch[], meLogin = ""): Promise<Map<string, string[]>> {
  const coverage = new Map<string, string[]>();
  if (!watches.length) return coverage;
  const store = await getStore().catch(() => null);
  if (!store) return coverage;
  const views = watches.some((w) => w.kind === "view") ? await viewsFor() : [];
  const rows = views.length ? buildViewRows(store) : [];
  // The viewer's own calendar day, as the client computes it (v5 4.9).
  const todayIso = localToday(new Date(), (await getPrefs(owner)).tz ?? undefined);
  for (const w of watches) {
    if (w.kind === "issue") {
      coverage.set(keyOf(w.kind, w.targetId), [w.targetId]);
      continue;
    }
    const view = views.find((v) => v.id === w.targetId);
    coverage.set(
      keyOf(w.kind, w.targetId),
      view ? runView(view, { viewerLogin: meLogin, todayIso, store }, rows).map((r) => r.nodeId) : [],
    );
  }
  return coverage;
}

/**
 * Per watch ("<kind>:<id>"): the field changes on the issues it covers, after the
 * login's last-seen time. The browser says which watches it cares about; the set of
 * issues each covers and the since-date are the server's, so nobody can ask about
 * someone else's last look or read changes on an item they don't watch.
 */
export async function collectWatchChanges(
  owner: string,
  items: WatchQuery[],
  loginOf: (userId: string) => string = (id) => id,
  meLogin = "",
): Promise<Record<string, FieldChange[]>> {
  const mine = new Map((await listWatches(owner)).map((w) => [keyOf(w.kind, w.targetId), w]));
  const wanted: Watch[] = [];
  const seen = new Set<string>();
  for (const it of items) {
    if (!it || typeof it !== "object" || !isWatchKind(it.kind) || typeof it.targetId !== "string") continue;
    const k = keyOf(it.kind, it.targetId);
    const w = mine.get(k);
    if (w && !seen.has(k)) {
      seen.add(k);
      wanted.push(w);
    }
  }
  if (!wanted.length) return {};
  const coverage = await watchCoverage(owner, wanted, meLogin);
  const out: Record<string, FieldChange[]> = {};
  for (const w of wanted) {
    const k = keyOf(w.kind, w.targetId);
    const nodeIds = (coverage.get(k) ?? []).slice(0, MAX_IDS);
    if (!nodeIds.length) continue;
    // After the last look, not at it: opening the item clears what came before.
    const since = new Date(Date.parse(w.lastSeenAt) + 1);
    const rows = await listFieldChanges({ since, issueNodeIds: nodeIds });
    out[k] = rows.map((c) =>
      // Assignee values are GitHub user IDs in the history; people read logins.
      c.field === "assignees"
        ? { ...c, oldValue: c.oldValue && setValue(parseSetValue(c.oldValue).map(loginOf)), newValue: c.newValue && setValue(parseSetValue(c.newValue).map(loginOf)) }
        : c,
    );
  }
  return out;
}
