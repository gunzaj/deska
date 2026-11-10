"use client";

// "Ask" (SPEC §4.9, AI4): a free-form question about one issue (the issue panel)
// or about the issues of a list ("Ask about this list"). The answer is text with
// issue references: a reference opens inside Deska, and nothing is ever applied, so
// there is no Accept. AI runs only when the user asks; a stored answer stays
// readable with AI off.
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { Job } from "@/lib/ai/runner";
import { longAgo, pluralize } from "@/lib/client/format";
import { usePoll } from "@/lib/client/poll";
import type { ClientIssue } from "@/lib/client/types";
import { useAppData } from "../app/provider";
import { useOpenIssue } from "../app/open-issue";
import { Icon } from "../icons";
import { Dialog } from "../ui/dialog";
import { btn } from "../ui/popover";
import { useToast } from "../ui/toast";

/** The list's numbers a question may name: the server sends at most this many (SPEC §4.9). */
export const ASK_LIST_MAX = 200;

/** The stored answer, as the GET routes return it (SPEC §4.9, AI4). */
type AnswerView = {
  /** The `ai_results` id, null without a database (demo and tests). */
  id: string | null;
  question: string;
  /** Markdown source. */
  answer: string;
  /** Already sanitized: only `https://github.com/…` links are anchors. */
  answerHtml: string;
  /** Issue numbers the answer names. */
  references: number[];
  provider: string;
  model: string;
  createdAt: string;
  /** False once the issue or the list changed: "Outdated · Run again". */
  fresh: boolean;
};
type AiStatus = { ready: boolean; reason: string | null };
type AskView = { answer: AnswerView | null; ai: AiStatus };

/** The issue links the answer may contain: they open inside Deska (SPEC §4.9). */
const ISSUE_LINK = /^https:\/\/github\.com\/[^/?#]+\/[^/?#]+\/issues\/(\d+)(?:[/?#].*)?$/;

async function call(url: string, method: "GET" | "POST", body?: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(url, { method, cache: "no-store", headers: body === undefined ? undefined : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const out = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(typeof out.error === "string" ? out.error : `Request failed (${res.status})`);
  return out;
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * The one job a surface may have running: POST it, poll it, cancel it. On "done"
 * the stored answer is read again (the answer carries the question, its HTML, the
 * references and the model), so a surface never shows a job's raw result.
 */
function useAsk(loadView: () => Promise<AskView>, askQuestion: (question: string) => Promise<Job>) {
  const { toast } = useToast();
  const [view, setView] = useState<AskView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // A GET or a run started before the newest one must not fill the surface.
  const seq = useRef(0);
  // What Retry asks again: the last question sent, also when the input changed since.
  const lastQuestion = useRef<string | null>(null);
  // The job being polled, by id; a ref so the poll reads the latest one.
  const runningJob = useRef<string | null>(null);
  runningJob.current = job?.id ?? null;
  const running = !!job && (job.state === "queued" || job.state === "running");

  const load = useCallback(
    async (signal?: AbortSignal) => {
      const my = ++seq.current;
      setLoadError(null);
      try {
        const body = await loadView();
        if (signal?.aborted || my !== seq.current) return;
        setView(body);
      } catch (e) {
        if (signal?.aborted || my !== seq.current) return;
        setLoadError(errorText(e));
      }
    },
    [loadView],
  );

  /** Forget the surface; a job still running is cancelled (closing or switching issues). */
  const reset = useCallback(() => {
    seq.current++;
    const id = runningJob.current;
    runningJob.current = null;
    if (id) void call(`/api/ai/jobs/${id}/cancel`, "POST").catch(() => null);
    setView(null);
    setLoadError(null);
    setJob(null);
    setRunError(null);
    setBusy(false);
  }, []);

  /** The one action that sends the issue or the list to the model. */
  const run = useCallback(
    async (question: string) => {
      const q = question.trim();
      if (!q || running || busy) return;
      lastQuestion.current = q;
      const my = ++seq.current;
      setBusy(true);
      setRunError(null);
      setJob(null);
      try {
        const next = await askQuestion(q);
        if (my !== seq.current) {
          // The surface was closed or reset while the job was being queued: stop it unseen.
          void call(`/api/ai/jobs/${next.id}/cancel`, "POST").catch(() => null);
          return;
        }
        if (next.state === "done") {
          // A job that ended before the first poll: read its stored answer.
          setBusy(false);
          void load();
          return;
        }
        if (next.state === "error") setRunError(next.error?.message ?? "The question failed.");
        else if (next.state !== "cancelled") setJob(next);
      } catch (e) {
        if (my === seq.current) setRunError(errorText(e));
      } finally {
        if (my === seq.current) setBusy(false);
      }
    },
    [askQuestion, busy, load, running],
  );

  const poll = useCallback(async () => {
    const id = runningJob.current;
    if (!id) return;
    let next: Job;
    try {
      next = ((await call(`/api/ai/jobs/${id}`, "GET")) as unknown as { job: Job }).job;
    } catch {
      return; // a transient poll failure: try again next tick
    }
    if (runningJob.current !== id) return;
    if (next.state === "done") {
      // The answer is stored server-side: read it again (SPEC §4.9).
      runningJob.current = null;
      setJob(null);
      void load();
    } else if (next.state === "error") {
      runningJob.current = null;
      setJob(null);
      setRunError(next.error?.message ?? "The question failed.");
    } else if (next.state === "cancelled") {
      runningJob.current = null;
      setJob(null);
    } else {
      setJob(next);
    }
  }, [load]);
  usePoll(poll, { every: 800, enabled: running });

  const cancel = useCallback(async () => {
    const id = runningJob.current;
    runningJob.current = null;
    seq.current++;
    setJob(null);
    setRunError(null);
    if (id) await call(`/api/ai/jobs/${id}/cancel`, "POST").catch(() => null);
  }, []);

  /** Ask the last question again (the error's Retry). */
  const retry = useCallback(() => {
    const q = lastQuestion.current;
    if (q) void run(q);
  }, [run]);

  /** Record the answer dismissed and drop it; returns its question for the form. */
  const dismiss = useCallback(async (): Promise<string | null> => {
    const answer = view?.answer;
    if (!answer) return null;
    if (answer.id) {
      try {
        await call(`/api/ai/results/${answer.id}/outcome`, "POST", { outcome: "dismissed" });
      } catch (e) {
        toast({ message: errorText(e) });
        return null;
      }
    }
    seq.current++;
    setView((v) => (v ? { ...v, answer: null } : v));
    return answer.question;
  }, [toast, view]);

  return { view, loadError, job, runError, busy, running, load, reset, run, retry, cancel, dismiss };
}

/** The question input, shared by the issue panel and the list dialog. */
function AskForm({
  question,
  onQuestion,
  onAsk,
  disabled,
  placeholder,
  hint,
  autoFocus,
}: {
  question: string;
  onQuestion: (question: string) => void;
  onAsk: () => void;
  /** A job runs (or is being queued): the form is disabled until it ends. */
  disabled: boolean;
  placeholder: string;
  hint: ReactNode;
  autoFocus?: boolean;
}) {
  const empty = question.trim() === "";
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!empty && !disabled) onAsk();
      }}
      className="space-y-1.5"
    >
      <div className="flex items-center gap-1.5">
        <input
          value={question}
          onChange={(e) => onQuestion(e.target.value)}
          aria-label="Your question"
          placeholder={placeholder}
          autoFocus={autoFocus}
          disabled={disabled}
          className="h-7 min-w-0 flex-1 rounded-md border border-line bg-field px-2 text-[12.5px] text-fg outline-none placeholder:text-faint focus:border-focus disabled:opacity-50"
        />
        <button type="submit" className={btn.outline} disabled={empty || disabled} data-ask-run>
          <Icon name="message" size={13} />
          Ask
        </button>
      </div>
      <p className="text-[11.5px] text-faint">{hint}</p>
    </form>
  );
}

/**
 * The answer, shared by the issue panel and the list dialog (SPEC §4.9, AI4).
 * `onOpenIssue` lets the list dialog close itself first (the side panel opens
 * behind a modal otherwise); the issue panel navigates to the issue's page.
 */
function AskAnswer({
  view,
  onRunAgain,
  onDismiss,
  onOpenIssue,
}: {
  view: AnswerView;
  onRunAgain: () => void;
  onDismiss: () => void;
  onOpenIssue?: (number: number) => void;
}) {
  const { byNumber } = useAppData();
  const openIssue = useOpenIssue();
  const open = onOpenIssue ?? openIssue;
  // The only clickable links are https://github.com/…: an issue link opens inside
  // Deska instead of a browser tab (SPEC §4.9, AI4).
  const onClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const anchor = (e.target as Element | null)?.closest?.("a");
      const match = anchor ? ISSUE_LINK.exec(anchor.getAttribute("href") ?? "") : null;
      if (!match) return;
      e.preventDefault();
      open(Number(match[1]));
    },
    [open],
  );
  return (
    <div className="space-y-2">
      <p className="text-[12.5px] text-muted" data-ask-question>
        {view.question}
      </p>
      <div className="gh-markdown" data-ask-answer onClick={onClick} dangerouslySetInnerHTML={{ __html: view.answerHtml }} />
      {view.references.length > 0 && (
        <div data-ask-references aria-label="Issues in this answer" className="flex flex-wrap items-center gap-1.5">
          {view.references.map((n) => {
            const issue = byNumber.get(n);
            return (
              <button
                key={n}
                type="button"
                onClick={() => open(n)}
                title={issue ? `Open #${n}: ${issue.title}` : `Open #${n} in Deska`}
                className="inline-flex h-6 max-w-full items-center rounded-full border border-line bg-surface px-2 text-[12px] text-muted transition-colors hover:bg-hover hover:text-fg"
              >
                <span className="truncate">
                  <span className="font-medium text-faint">#{n}</span>
                  {issue ? ` ${issue.title}` : ""}
                </span>
              </button>
            );
          })}
        </div>
      )}
      <p className="text-[11.5px] text-faint" data-ask-meta>
        {view.provider || "AI"}
        {view.model ? ` · ${view.model}` : ""} · {longAgo(view.createdAt)}
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        {!view.fresh && (
          <>
            <span className="text-[11.5px] font-medium text-warning" data-ask-outdated>
              Outdated · Run again
            </span>
            <button type="button" onClick={onRunAgain} className={btn.ghost} data-ask-run-again>
              <Icon name="refresh" size={13} />
              Run again
            </button>
          </>
        )}
        <button type="button" onClick={onDismiss} className={btn.ghost} data-ask-dismiss>
          <Icon name="x" size={13} />
          Dismiss
        </button>
      </div>
    </div>
  );
}

/** The running / error / answer block below a form. */
function AskBody({
  job,
  runError,
  answer,
  onRetry,
  onCancel,
  onRunAgain,
  onDismiss,
  onOpenIssue,
}: {
  job: Job | null;
  runError: string | null;
  answer: AnswerView | null;
  onRetry: () => void;
  onCancel: () => void;
  onRunAgain: () => void;
  onDismiss: () => void;
  onOpenIssue?: (number: number) => void;
}) {
  const running = !!job && (job.state === "queued" || job.state === "running");
  const error = runError ?? (job?.state === "error" ? (job.error?.message ?? "The question failed.") : null);
  if (running) {
    return (
      <div className="flex items-center gap-2 text-[12.5px] text-muted" role="status">
        <span className="size-3 animate-spin rounded-full border-2 border-line border-t-brand" aria-label="Asking the model" />
        Asking the model…
        <button type="button" onClick={onCancel} className={btn.ghost} data-ask-cancel>
          Cancel
        </button>
      </div>
    );
  }
  if (error) {
    return (
      <div className="space-y-1.5">
        <p role="alert" className="text-[12.5px] text-critical">
          {error}
        </p>
        <button type="button" onClick={onRetry} className={btn.outline} data-ask-retry>
          <Icon name="refresh" size={13} />
          Retry
        </button>
      </div>
    );
  }
  return answer ? <AskAnswer view={answer} onRunAgain={onRunAgain} onDismiss={onDismiss} onOpenIssue={onOpenIssue} /> : null;
}

/** The AI-off reason and the way to Settings → AI; nothing is sent (SPEC §4.9). */
function AiOff({ reason }: { reason: string | null }) {
  return (
    <div className="space-y-2">
      <p role="alert" className="text-[12.5px] text-critical">
        {reason ?? "AI assist is off. Choose a provider in Settings → AI."}
      </p>
      <Link href="/settings#ai" className="text-[12.5px] font-medium text-brand hover:underline">
        Settings → AI
      </Link>
    </div>
  );
}

/** "Ask about this issue": the issue panel's section (SPEC §4.9, AI4). */
export function IssueAsk({ number }: { number: number }) {
  const loadView = useCallback(async () => (await call(`/api/issues/${number}/ask`, "GET")) as unknown as AskView, [number]);
  const askQuestion = useCallback(async (question: string) => ((await call(`/api/issues/${number}/ask`, "POST", { question })) as unknown as { job: Job }).job, [number]);
  const { view, loadError, job, runError, busy, running, load, reset, run, retry, cancel, dismiss } = useAsk(loadView, askQuestion);
  const [question, setQuestion] = useState("");
  const answer = view?.answer ?? null;
  const ready = view?.ai.ready ?? false;

  useEffect(() => {
    const ctrl = new AbortController();
    setQuestion("");
    reset();
    void load(ctrl.signal);
    return () => ctrl.abort();
  }, [load, reset]);

  // Loading, or AI off with nothing stored: the issue panel stays clean.
  if (!view) {
    return loadError ? <p className="text-[12.5px] text-critical">Could not load the answer: {loadError}</p> : null;
  }
  if (!ready && !answer) return null;

  return (
    <section aria-label="Ask about this issue" data-ask-issue className="space-y-2">
      <h3 className="text-[12.5px] font-semibold text-muted">Ask about this issue</h3>
      {ready && (
        <AskForm
          question={question}
          onQuestion={setQuestion}
          onAsk={() => void run(question)}
          disabled={running || busy}
          placeholder="Ask a question about this issue…"
          hint="Sends this issue, its comments and your question to the model you chose. Nothing changes."
        />
      )}
      {ready ? (
        <AskBody
          job={job}
          runError={runError}
          answer={answer}
          onRetry={retry}
          onCancel={() => void cancel()}
          onRunAgain={() => answer && void run(answer.question)}
          onDismiss={() => void dismiss().then((q) => q !== null && setQuestion(q))}
        />
      ) : (
        answer && <AskAnswer view={answer} onRunAgain={() => void run(answer.question)} onDismiss={() => void dismiss().then((q) => q !== null && setQuestion(q))} />
      )}
    </section>
  );
}

/** One list's subject: at most 200 numbers in display order, and the full row count. */
type ListSubject = { numbers: number[]; total: number };

const subjectOf = (rows: ClientIssue[]): ListSubject => ({ numbers: rows.slice(0, ASK_LIST_MAX).map((r) => r.number), total: rows.length });

/** "Ask about this list": the list toolbar's button and dialog (SPEC §4.9, AI4). */
export function AskList({ rows }: { rows: ClientIssue[] }) {
  const [open, setOpen] = useState(false);
  // The subject is fixed when the dialog opens, so the answer's GET and the run's POST
  // always name the same list (the list behind can refresh while the dialog is open).
  const [subject, setSubject] = useState<ListSubject | null>(null);
  const subjectRef = useRef<ListSubject | null>(null);
  const [question, setQuestion] = useState("");
  const loadView = useCallback(async () => {
    const s = subjectRef.current;
    if (!s) throw new Error("There is no list to ask about.");
    return (await call(`/api/ai/ask?numbers=${s.numbers.join(",")}&total=${s.total}`, "GET")) as unknown as AskView;
  }, []);
  const askQuestion = useCallback(async (question: string) => {
    const s = subjectRef.current;
    if (!s) throw new Error("There is no list to ask about.");
    return ((await call("/api/ai/ask", "POST", { question, numbers: s.numbers, total: s.total })) as unknown as { job: Job }).job;
  }, []);
  const { view, loadError, job, runError, busy, running, load, reset, run, retry, cancel, dismiss } = useAsk(loadView, askQuestion);
  const answer = view?.answer ?? null;
  const ready = view?.ai.ready ?? false;
  const openIssue = useOpenIssue();

  const openDialog = useCallback(() => {
    const next = subjectOf(rows);
    subjectRef.current = next;
    setSubject(next);
    setQuestion("");
    reset();
    setOpen(true);
    void load();
  }, [load, reset, rows]);

  const close = useCallback(() => {
    setOpen(false);
    subjectRef.current = null;
    setSubject(null);
    reset();
  }, [reset]);

  /** A reference opens the side panel: the dialog steps out of its way first (Tidy Inbox does the same). */
  const openReference = useCallback(
    (number: number) => {
      close();
      openIssue(number);
    },
    [close, openIssue],
  );

  const total = subject?.total ?? rows.length;

  return (
    <>
      <button
        type="button"
        onClick={openDialog}
        className={btn.outline}
        disabled={rows.length === 0}
        title={rows.length === 0 ? "This list is empty" : "Ask the model a question about this list"}
        data-ask-list
      >
        <Icon name="message" size={13} />
        Ask about this list
      </button>
      <Dialog open={open} onClose={close} label="Ask about this list" width={520}>
        <div className="max-h-[80vh] space-y-3 overflow-y-auto p-4" data-ask-list-dialog>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[14px] font-semibold">Ask about this list</p>
              <p className="text-[12px] text-faint">{pluralize(total, "issue")}</p>
            </div>
            <button type="button" onClick={close} aria-label="Close" className={btn.icon}>
              <Icon name="x" size={15} />
            </button>
          </div>

          {subject && subject.total > ASK_LIST_MAX && (
            <p className="rounded-lg bg-banner-warning px-3 py-2 text-[12.5px] text-warning" data-ask-limit>
              Only the first {ASK_LIST_MAX} of {subject.total} issues are sent.
            </p>
          )}

          {!view ? (
            loadError ? (
              <div className="space-y-2">
                <p role="alert" className="text-[12.5px] text-critical">
                  Could not read the answer: {loadError}
                </p>
                <button type="button" onClick={() => void load()} className={btn.outline} data-ask-retry>
                  <Icon name="refresh" size={13} />
                  Try again
                </button>
              </div>
            ) : (
              <p role="status" className="text-[12.5px] text-muted">
                Reading the stored answer…
              </p>
            )
          ) : !ready && !answer ? (
            <AiOff reason={view.ai.reason} />
          ) : (
            <>
              {ready && (
                <AskForm
                  question={question}
                  onQuestion={setQuestion}
                  onAsk={() => void run(question)}
                  disabled={running || busy}
                  placeholder="Ask a question about this list…"
                  hint="Sends these issues and your question to the model you chose. Nothing changes."
                  autoFocus
                />
              )}
              <AskBody
                job={job}
                runError={runError}
                answer={answer}
                onRetry={retry}
                onCancel={() => void cancel()}
                onRunAgain={() => answer && void run(answer.question)}
                onDismiss={() => void dismiss().then((q) => q !== null && setQuestion(q))}
                onOpenIssue={openReference}
              />
            </>
          )}
        </div>
      </Dialog>
    </>
  );
}
