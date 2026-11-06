"use client";

// Editing issues in Deska (IMPROVEMENTS W2): optimistic updates through the
// provider's overlay, the durable outbox behind POST /api/issues/[n]/edit,
// a spinner on fields with an edit in flight (also after a reload, from
// GET /api/outbox), rollback and a toast on failure, and the SPEC §5
// conflict dialog.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { EDITING_OFF, editRequest, wirePatch, type EditField } from "@/lib/client/edit";
import { isUnauthorized } from "@/lib/client/session";
import { usePoll } from "@/lib/client/poll";
import type { ClientIssue, ClientMeta } from "@/lib/client/types";
import { useAppData } from "../app/provider";
import { Dialog } from "../ui/dialog";
import { btn } from "../ui/popover";
import { useToast } from "../ui/toast";

type Entry = { id: string; issueNodeId: string; op: string; field: string | null; status: string; error: string | null; remote: unknown; next: unknown };

type Conflict = { issue: ClientIssue; field: EditField; next: unknown; remote: unknown };

/** How an edit ended: written, queued for a retry, a conflict, failed, or refused before sending. */
export type EditOutcome = "done" | "pending" | "conflict" | "failed" | "refused";

type EditsCtx = {
  /** Whether this issue's field has an edit in flight. */
  isPending: (nodeId: string, field: EditField) => boolean;
  /**
   * Edit one field; resolves when the server answered (or the edit was
   * refused locally). `quiet` (bulk edits, W4) reports problems only through
   * the outcome: no toast, no conflict dialog.
   */
  edit: (issue: ClientIssue, field: EditField, next: unknown, opts?: { base?: unknown; quiet?: boolean }) => Promise<EditOutcome>;
  /** Whether edits are possible, and why not. */
  disabledReason: string | null;
};

const Ctx = createContext<EditsCtx | null>(null);

export function useIssueEdits(): EditsCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useIssueEdits outside EditsProvider");
  return c;
}

const fieldKey = (nodeId: string, field: string) => `${nodeId}:${field}`;
const POLL_MS = 10_000;

/** A value as people read it: option and iteration names, never IDs. */
export function valueText(meta: ClientMeta, field: EditField, v: unknown): string {
  if (v == null || v === "") return "empty";
  const id = String(v);
  switch (field) {
    case "status":
    case "priority":
    case "team":
    case "platform":
      return meta.fields[field].find((o) => o.id === id)?.name ?? "missing option";
    case "release":
      return meta.releases.find((r) => r.id === id)?.title ?? "missing release";
    case "type":
      return meta.issueTypes.find((t) => t.id === id)?.name ?? "missing type";
    case "milestone":
      return meta.milestones.find((m) => m.id === id)?.title ?? "missing milestone";
    case "state":
      return id;
    default:
      return Array.isArray(v) ? v.join(", ") : id;
  }
}

export function EditsProvider({ children }: { children: ReactNode }) {
  const { data, byNodeId, wireIssue, overlayIssue, clearOverlay, commitIssue, refresh } = useAppData();
  const { toast } = useToast();
  const meta = data.meta;
  const [pending, setPending] = useState<Map<string, number>>(() => new Map());
  // Edits the outbox still holds (202, or seen in GET /api/outbox after a reload).
  const [queued, setQueued] = useState<Set<string>>(() => new Set());
  const [conflict, setConflict] = useState<Conflict | null>(null);
  // A queued edit keeps its overlay until the outbox has written it and the
  // refreshed row agrees; dropping it at the 202 made the field flip back to
  // the old value (the cache has not moved yet) while its spinner still showed
  // (v5 3.11).
  const queuedOverlays = useRef(new Map<string, { nodeId: string; keys: string[] }>());
  const queuedRef = useRef(queued);
  queuedRef.current = queued;

  const bump = useCallback((key: string, by: number) => {
    setPending((prev) => {
      const n = (prev.get(key) ?? 0) + by;
      const next = new Map(prev);
      if (n > 0) next.set(key, n);
      else next.delete(key);
      return next;
    });
  }, []);

  // After a reload: show the edits the outbox still holds, and watch them
  // until they're written.
  const loadQueued = useCallback(async () => {
    if (!meta.writeMode) return;
    const res = await fetch("/api/outbox?mine=1", { cache: "no-store" }).catch(() => null);
    if (isUnauthorized(res) || !res?.ok) return;
    const { entries } = (await res.json()) as { entries: Entry[] };
    const keys = new Set(entries.filter((e) => e.status === "pending").map((e) => fieldKey(e.issueNodeId, e.field ?? "state")));
    // Something we were waiting for went through (or failed): fetch the new
    // data, then drop its overlay, so the row never shows a value in between.
    const gone = [...queuedRef.current].filter((k) => !keys.has(k));
    setQueued(keys);
    if (!gone.length) return;
    await refresh();
    for (const k of gone) {
      const o = queuedOverlays.current.get(k);
      if (!o) continue;
      clearOverlay(o.nodeId, o.keys);
      queuedOverlays.current.delete(k);
    }
  }, [meta.writeMode, refresh, clearOverlay]);
  useEffect(() => {
    void loadQueued();
  }, [loadQueued]);
  // Only while something is queued; not in a hidden tab, not after the session expired.
  usePoll(loadQueued, { every: POLL_MS, enabled: queued.size > 0, immediate: false });

  const edit = useCallback(
    async (issue: ClientIssue, field: EditField, next: unknown, opts: { base?: unknown; quiet?: boolean } = {}): Promise<EditOutcome> => {
      if (!meta.writeMode) {
        if (!opts.quiet) toast({ message: meta.editOffReason ?? EDITING_OFF });
        return "refused";
      }
      if (field === "state" && next === "closed" && meta.closeBlocked) {
        if (!opts.quiet) toast({ message: `Can't close here: ${meta.closeBlocked}`, kind: "error" });
        return "refused";
      }
      const w = wireIssue(issue.nodeId);
      if (!w) return "refused";
      const patch = wirePatch(w, field, next);
      const keys = Object.keys(patch);
      const key = fieldKey(issue.nodeId, field);
      overlayIssue(issue.nodeId, patch);
      bump(key, 1);
      const body = editRequest(issue, field, next, crypto.randomUUID());
      if (opts.base !== undefined) body.base = opts.base;
      const res = await fetch(`/api/issues/${issue.number}/edit`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
      const out = (await res?.json().catch(() => null)) as { entry?: Entry; error?: string } | null;
      bump(key, -1);
      if (isUnauthorized(res)) {
        clearOverlay(issue.nodeId, keys);
        return "failed";
      }
      if (res?.status === 200 || res?.status === 202) {
        if (res.status === 202) {
          // The outbox has it and will write it later: keep the overlay (see above).
          queuedOverlays.current.set(key, { nodeId: issue.nodeId, keys });
          setQueued((prev) => new Set(prev).add(key));
          return "pending";
        }
        // Written: the value is final, so it goes into the loaded row itself.
        commitIssue(issue.nodeId, patch);
        clearOverlay(issue.nodeId, keys);
        return "done";
      }
      // Anything else puts the old value back: the loaded row was never
      // changed, so dropping the overlay is the rollback.
      clearOverlay(issue.nodeId, keys);
      if (res?.status === 409 && out?.entry?.status === "conflict") {
        if (!opts.quiet) setConflict({ issue, field, next, remote: out.entry.remote ?? null });
        return "conflict";
      }
      if (!opts.quiet) toast({ message: `Couldn't save: ${out?.error ?? out?.entry?.error ?? (res ? `HTTP ${res.status}` : "network error")}`, kind: "error" });
      return "failed";
    },
    [meta.writeMode, meta.editOffReason, meta.closeBlocked, wireIssue, overlayIssue, clearOverlay, commitIssue, bump, toast],
  );

  const value = useMemo<EditsCtx>(
    () => ({
      isPending: (nodeId, field) => pending.has(fieldKey(nodeId, field)) || queued.has(fieldKey(nodeId, field)),
      edit,
      disabledReason: meta.writeMode ? null : (meta.editOffReason ?? EDITING_OFF),
    }),
    [pending, queued, edit, meta.writeMode, meta.editOffReason],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      <ConflictDialog
        conflict={conflict}
        meta={meta}
        onClose={() => setConflict(null)}
        onKeepTheirs={(c) => {
          // GitHub wins: show its value now. The server re-read the issue on
          // the conflict, so the next background refresh agrees; refetching
          // right away could hit an instance still serving its older model.
          const w = wireIssue(c.issue.nodeId);
          if (w) commitIssue(c.issue.nodeId, wirePatch(w, c.field, c.remote));
          setConflict(null);
        }}
        onOverwrite={(c) => {
          setConflict(null);
          // Same value, with what GitHub holds now as the base.
          const fresh = byNodeId.get(c.issue.nodeId) ?? c.issue;
          void edit(fresh, c.field, c.next, { base: c.remote });
        }}
      />
    </Ctx.Provider>
  );
}

function ConflictDialog({
  conflict,
  meta,
  onClose,
  onKeepTheirs,
  onOverwrite,
}: {
  conflict: Conflict | null;
  meta: ClientMeta;
  onClose: () => void;
  onKeepTheirs: (c: Conflict) => void;
  onOverwrite: (c: Conflict) => void;
}) {
  const c = conflict;
  const label = c ? (c.field === "state" ? "State" : c.field[0]!.toUpperCase() + c.field.slice(1)) : "";
  return (
    <Dialog open={c != null} onClose={onClose} label="Edit conflict" width={440}>
      {c && (
        <div className="p-4">
          {/* The re-read doesn't say who made the change. */}
          <p className="text-[14px] font-semibold">Changed on GitHub by someone</p>
          <p className="mt-1 text-muted">
            {label} of #{c.issue.number} changed since you opened it.
          </p>
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[13px]">
            <dt className="text-faint">Theirs</dt>
            <dd data-testid="conflict-theirs">{valueText(meta, c.field, c.remote)}</dd>
            <dt className="text-faint">Yours</dt>
            <dd data-testid="conflict-yours">{valueText(meta, c.field, c.next)}</dd>
          </dl>
          <div className="mt-4 flex justify-end gap-1.5">
            <button type="button" onClick={() => onKeepTheirs(c)} className={btn.outline}>
              Keep theirs
            </button>
            <button type="button" onClick={() => onOverwrite(c)} className={btn.primary}>
              Overwrite
            </button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
