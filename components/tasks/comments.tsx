"use client";

import { useCallback, useRef, useState } from "react";
import { longAgo } from "@/lib/client/format";
import type { TaskComment } from "@/lib/tasks/model";
import { Icon } from "../icons";
import { btn } from "../ui/popover";
import { isUnauthorized } from "@/lib/client/session";
import { usePoll } from "@/lib/client/poll";

type Shown = TaskComment & { bodyHtml: string };

const REFRESH_MS = 30_000;

/** Comment thread on the task panel (SPEC §12.7): private notes in markdown, which you can edit and delete. */
export function TaskComments({ taskId }: { taskId: string }) {
  const [list, setList] = useState<Shown[] | null>(null);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // ⌘↵ doesn't go through the disabled button, so guard sends here too.
  const sending = useRef(false);
  // Only the newest load applies: a refresh sent before a post mustn't hide the new comment.
  const loadSeq = useRef(0);

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    const res = await fetch(`/api/tasks/${taskId}/comments`, { cache: "no-store" }).catch(() => null);
    if (isUnauthorized(res) || !res?.ok) return;
    const body = (await res.json()) as Shown[];
    if (seq === loadSeq.current) setList(body);
  }, [taskId]);

  // Also catches up when the tab becomes visible again (v5 4.7).
  usePoll(load, { every: REFRESH_MS });

  const send = async (url: string, method: string, body?: unknown) => {
    if (sending.current) return false;
    sending.current = true;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
      if (isUnauthorized(res)) return false;
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `HTTP ${res.status}`);
      await load();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };

  const post = async () => {
    const text = draft;
    if (!text.trim()) return;
    if (await send(`/api/tasks/${taskId}/comments`, "POST", { body: text })) {
      // Clear only if unchanged: don't wipe text typed while sending.
      setDraft((d) => (d === text ? "" : d));
    }
  };

  return (
    <section className="mt-5 border-t border-line pt-3" aria-label="Comments">
      <h3 className="mb-2 flex items-center gap-2 text-[12.5px] font-semibold text-muted">
        Comments
        {list && list.length > 0 && <span className="font-normal text-faint">{list.length}</span>}
      </h3>
      <ol className="space-y-3">
        {(list ?? []).map((c) => (
          <li key={c.id} className="group">
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 text-[12px] text-faint">
                <span title={c.createdAt}>{longAgo(c.createdAt)}</span>
                {c.updatedAt !== c.createdAt && <span>· edited</span>}
                <span className="flex-1" />
                {editing?.id !== c.id && (
                  <span className="opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                    <button type="button" onClick={() => setEditing({ id: c.id, body: c.body })} className="px-1 hover:text-fg" aria-label="Edit comment">
                      Edit
                    </button>
                    <button type="button" onClick={() => void send(`/api/tasks/${taskId}/comments/${c.id}`, "DELETE")} className="px-1 hover:text-fg" aria-label="Delete comment">
                      Delete
                    </button>
                  </span>
                )}
              </p>
              {editing?.id === c.id ? (
                <div className="mt-1">
                  <textarea
                    autoFocus
                    aria-label="Edit comment"
                    value={editing.body}
                    onChange={(e) => setEditing({ id: c.id, body: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                        void send(`/api/tasks/${taskId}/comments/${c.id}`, "PATCH", { body: editing.body }).then((ok) => {
                          if (ok) setEditing(null);
                        });
                      }
                      if (e.key === "Escape") {
                        e.stopPropagation();
                        setEditing(null);
                      }
                    }}
                    className="min-h-16 w-full resize-y rounded-lg border border-line bg-surface p-2 text-[13px] outline-none focus:border-[var(--focus)]"
                  />
                  <div className="mt-1 flex gap-1.5">
                    <button type="button" disabled={busy} onClick={() =>
                        void send(`/api/tasks/${taskId}/comments/${c.id}`, "PATCH", { body: editing.body }).then((ok) => {
                          if (ok) setEditing(null);
                        })
                      } className={btn.primary}>
                      Save
                    </button>
                    <button type="button" onClick={() => setEditing(null)} className={btn.ghost}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="gh-markdown mt-0.5 text-[13.5px]" dangerouslySetInnerHTML={{ __html: c.bodyHtml }} />
              )}
            </div>
          </li>
        ))}
      </ol>
      {list && list.length === 0 && <p className="text-[12.5px] text-faint">No comments yet. Notes stay on this Mac.</p>}
      <div className="mt-3">
        <div className="min-w-0 flex-1">
          <textarea
            aria-label="Write a comment"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void post();
              }
            }}
            placeholder="Write a comment… (markdown, ⌘↵ to send)"
            rows={2}
            className="w-full resize-y rounded-lg border border-line bg-surface p-2 text-[13px] outline-none placeholder:text-faint focus:border-[var(--focus)]"
          />
          {error && <p className="text-[12px] text-critical">{error}</p>}
          <div className="mt-1 flex justify-end">
            <button type="button" disabled={!draft.trim() || busy} onClick={() => void post()} className={btn.primary}>
              <Icon name="message" size={13} /> Comment
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
