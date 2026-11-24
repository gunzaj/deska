"use client";

// Commenting from the issue panel (SPEC §4.8): a text box under the thread that
// posts through POST /api/issues/[n]/comments (the write gate and the outbox).
// The draft stays until GitHub has the comment; a failure puts it back.
import { useCallback, useEffect, useRef, useState } from "react";
import { isUnauthorized } from "@/lib/client/session";
import { usePoll } from "@/lib/client/poll";
import type { ClientIssue } from "@/lib/client/types";
import { useAppData } from "../app/provider";
import { Icon } from "../icons";
import { Avatar } from "../props";
import { btn } from "../ui/popover";
import { useToast } from "../ui/toast";
import { useIssueEdits } from "./edits";

/** A comment GitHub confirmed, to show before the thread is read again. */
export type PostedComment = { id: string; url: string; body: string };

type Entry = { idempotencyKey?: string; status: string; error: string | null };
type Queued = { id: string; body: string };

// Kept outside the component: opening another issue and coming back keeps the
// text, and a comment the outbox still holds is watched again.
const drafts = new Map<number, string>();
const queuedComments = new Map<number, Queued>();

const POLL_MS = 3_000;
/** Longest the box waits on one request; past this the outbox has the comment. */
const SEND_TIMEOUT_MS = 20_000;

export function CommentBox({ issue, onPosted }: { issue: ClientIssue; onPosted: (comment: PostedComment | null) => void }) {
  const { data, avatarOf } = useAppData();
  const { disabledReason } = useIssueEdits();
  const { toast } = useToast();
  const number = issue.number;
  const [text, setText] = useState(() => drafts.get(number) ?? "");
  const [sending, setSending] = useState(false);
  const [queued, setQueued] = useState<Queued | null>(() => queuedComments.get(number) ?? null);
  const onPostedRef = useRef(onPosted);
  onPostedRef.current = onPosted;

  const write = (value: string) => {
    setText(value);
    if (value) drafts.set(number, value);
    else drafts.delete(number);
  };

  // A comment the outbox is still sending (GitHub was slow or failed for a
  // moment): done rows leave the list, so "not listed" means it is posted.
  const check = useCallback(async () => {
    const waiting = queuedComments.get(number);
    if (!waiting) return;
    const res = await fetch("/api/outbox?mine=1", { cache: "no-store" }).catch(() => null);
    if (isUnauthorized(res) || !res?.ok) return;
    const { entries } = (await res.json()) as { entries: Entry[] };
    const entry = entries.find((e) => e.idempotencyKey?.endsWith(`:${waiting.id}`));
    if (entry && (entry.status === "pending" || entry.status === "sending")) return;
    queuedComments.delete(number);
    setQueued(null);
    if (!entry) {
      onPostedRef.current(null);
      return;
    }
    // It never reached GitHub: give the text back, unless a new draft was started.
    if (!drafts.get(number)) {
      drafts.set(number, waiting.body);
      setText(waiting.body);
    }
    toast({ message: `Couldn't post the comment on #${number}: ${entry.error ?? entry.status}`, kind: "error" });
  }, [number, toast]);
  usePoll(check, { every: POLL_MS, enabled: queued != null, immediate: false });

  const send = async () => {
    const body = text.trim();
    if (!body || sending || queued || disabledReason) return;
    setSending(true);
    const id = crypto.randomUUID();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), SEND_TIMEOUT_MS);
    let timedOut = false;
    const res = await fetch(`/api/issues/${number}/comments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body, idempotencyKey: id }),
      signal: ctrl.signal,
    }).catch(() => {
      timedOut = ctrl.signal.aborted;
      return null;
    });
    const out = (await res?.json().catch(() => null)) as { entry?: { result?: { id?: string; url?: string } | null; error?: string | null }; error?: string } | null;
    clearTimeout(timer);
    setSending(false);
    if (isUnauthorized(res)) return;
    if (res?.status === 201) {
      write("");
      const made = out?.entry?.result;
      onPosted(made?.id ? { id: made.id, url: made.url ?? "", body } : null);
      return;
    }
    if (res?.status === 202 || timedOut) {
      // The outbox has it and sends it as soon as GitHub answers.
      const waiting = { id, body };
      queuedComments.set(number, waiting);
      setQueued(waiting);
      write("");
      return;
    }
    toast({ message: `Couldn't post the comment: ${out?.error ?? out?.entry?.error ?? (res ? `HTTP ${res.status}` : "network error")}`, kind: "error" });
  };

  // Opened on an issue whose comment was still queued: look right away.
  useEffect(() => {
    if (queuedComments.has(number)) void check();
  }, [number, check]);

  const off = disabledReason != null;
  const busy = sending || queued != null;
  return (
    <form
      data-comment-box
      className="mt-4 flex gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      <Avatar login={data.meta.viewer} url={avatarOf(data.meta.viewer)} size={26} />
      <div className="min-w-0 flex-1">
        <textarea
          aria-label="Add a comment"
          placeholder={off ? "Commenting is off" : "Add a comment… Markdown works"}
          value={queued ? queued.body : text}
          disabled={off}
          readOnly={busy}
          rows={3}
          maxLength={65_536}
          onChange={(e) => write(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void send();
            }
          }}
          className="block min-h-20 w-full resize-y rounded-xl border border-line bg-surface px-3 py-2 text-[14px] outline-none placeholder:text-faint focus:border-[var(--focus)] disabled:opacity-60"
        />
        <div className="mt-2 flex min-h-7 items-center gap-2">
          <p className="flex min-w-0 items-center gap-1.5 text-[11.5px] text-faint" role={queued ? "status" : undefined}>
            {off ? (
              <>
                <Icon name="lock" size={11} /> {disabledReason}
              </>
            ) : queued ? (
              "GitHub is slow to answer. The comment is sent as soon as it can be."
            ) : (
              "⌘↵ to send"
            )}
          </p>
          <span className="flex-1" />
          {off && !data.meta.demo ? (
            <a href={`${issue.url}#new_comment_field`} target="_blank" rel="noreferrer" className={btn.outline}>
              <Icon name="message" size={13} /> Reply on GitHub
            </a>
          ) : null}
          <button type="submit" disabled={off || busy || !text.trim()} title={disabledReason ?? "Post this comment on GitHub (⌘↵)"} className={btn.primary}>
            {busy && <span role="status" aria-label="Sending" className="size-3 animate-spin rounded-full border-2 border-brand-on/40 border-t-brand-on" />}
            Comment
          </button>
        </div>
      </div>
    </form>
  );
}
