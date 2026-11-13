"use client";

// AI triage suggestion in the issue panel (SPEC §4.9, AI1): run it when the
// user asks, show the suggestion, Accept / Edit / Dismiss. The model only
// suggests: Accept writes to GitHub through the write gate (W1), so while writes
// are off it is disabled with the reason. Nothing is sent until AI is on and
// "Test connection" passed; a changed issue marks the suggestion outdated.
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { Job } from "@/lib/ai/runner";
import type { TriageFlag, TriageSuggestion } from "@/lib/ai/triage";
import { EDITING_OFF } from "@/lib/client/edit";

/** Why Accept and Edit are off on a suggestion made for an older version of the issue. */
const OUTDATED = "The issue changed since this suggestion was made. Run it again.";
import { longAgo, plainName } from "@/lib/client/format";
import { usePoll } from "@/lib/client/poll";
import { Elapsed } from "../ai/elapsed";
import { useAppData } from "../app/provider";
import { useOpenIssue } from "../app/open-issue";
import { Icon } from "../icons";
import { Dialog } from "../ui/dialog";
import { btn } from "../ui/popover";
import { useToast } from "../ui/toast";

/** The free key in triage mode (SPEC §4.9, AI1): asks for a suggestion for the issue on screen. */
export const AI_TRIAGE_EVENT = "deska:ai-triage";

type Suggestion = {
  /** The `ai_results` id, null without a database (demo and tests). */
  id: string | null;
  result: TriageSuggestion;
  provider: string;
  model: string;
  createdAt: string;
  acceptedAt: string | null;
  dismissedAt: string | null;
  /** False once the issue changed on GitHub: "Outdated · Run again". */
  fresh: boolean;
};
type View = { suggestion: Suggestion | null; ai: { ready: boolean; reason: string | null } };

/** The suggestion parts the model actually proposed (SPEC §4.9). */
function suggestedParts(result: TriageSuggestion, hasSprint: boolean): string[] {
  return [
    ...(result.status ? ["status"] : []),
    ...(result.priority ? ["priority"] : []),
    ...(result.dimension ? ["dimension"] : []),
    ...(result.sprint && hasSprint ? ["sprint"] : []),
    ...(result.labels?.length ? ["labels"] : []),
  ];
}

const CONFIDENCE: Record<string, string> = { low: "low confidence", medium: "medium confidence", high: "high confidence" };
const FLAG: Record<TriageFlag["flag"], string> = { needs_info: "Needs info", probably_fixed: "Probably fixed", stale: "Stale" };

async function call(url: string, method: "GET" | "POST", body?: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(url, { method, cache: "no-store", headers: body === undefined ? undefined : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const out = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(typeof out.error === "string" ? out.error : `Request failed (${res.status})`);
  return out;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 text-[13px]">
      <span className="w-[4.5rem] shrink-0 text-[12.5px] text-faint">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export function IssueAiSuggestion({ number }: { number: number }) {
  const { data, byNumber, option, release, refresh } = useAppData();
  const open = useOpenIssue();
  const { toast } = useToast();
  const [view, setView] = useState<View | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  /** The parts the Edit dialog keeps checked; null = the dialog is closed. */
  const [editing, setEditing] = useState<Set<string> | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const meta = data.meta;

  const load = useCallback(async (signal: AbortSignal) => {
    const body = (await call(`/api/issues/${number}/ai`, "GET")) as unknown as View;
    if (!signal.aborted) setView(body);
  }, [number]);

  useEffect(() => {
    const ctrl = new AbortController();
    setView(null);
    setJob(null);
    setRunError(null);
    setLoadError(null);
    load(ctrl.signal).catch((e) => {
      if (!ctrl.signal.aborted) setLoadError(e instanceof Error ? e.message : String(e));
    });
    return () => ctrl.abort();
  }, [load]);

  const running = !!job && (job.state === "queued" || job.state === "running");

  const run = useCallback(async () => {
    if (running) return;
    if (!view?.ai.ready) {
      // Nothing is sent when AI can't run: say why (SPEC §4.9).
      if (view?.ai.reason) toast({ message: view.ai.reason });
      return;
    }
    setBusy(true);
    setRunError(null);
    setJob(null);
    try {
      const body = (await call(`/api/issues/${number}/ai`, "POST")) as unknown as { job: Job };
      if (body.job.state === "error") setRunError(body.job.error?.message ?? "The suggestion failed.");
      else setJob(body.job);
    } catch (e) {
      setRunError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [number, running, toast, view?.ai.ready, view?.ai.reason]);

  const jobId = useRef<string | null>(null);
  jobId.current = job?.id ?? null;
  const poll = useCallback(async () => {
    const id = jobId.current;
    if (!id) return;
    const body = (await call(`/api/ai/jobs/${id}`, "GET")) as unknown as { job: Job };
    setJob(body.job);
  }, []);
  usePoll(poll, { every: 800, enabled: running });

  const cancel = useCallback(async () => {
    if (!job) return;
    await call(`/api/ai/jobs/${job.id}/cancel`, "POST").catch(() => null);
    setJob(null);
  }, [job]);

  // The free key in triage mode asks the same thing as the button (AI1).
  const runRef = useRef(run);
  runRef.current = run;
  useEffect(() => {
    const onRun = () => void runRef.current();
    window.addEventListener(AI_TRIAGE_EVENT, onRun);
    return () => window.removeEventListener(AI_TRIAGE_EVENT, onRun);
  }, []);

  const fromJob: Suggestion | null =
    job?.state === "done" && job.result != null
      ? { id: job.resultId, result: job.result as TriageSuggestion, provider: job.provider ?? "", model: job.model ?? "", createdAt: job.finishedAt ?? job.createdAt, acceptedAt: null, dismissedAt: null, fresh: true }
      : null;
  const suggestion = fromJob ?? view?.suggestion ?? null;
  const error = runError ?? (job?.state === "error" ? (job.error?.message ?? "The suggestion failed.") : null);

  const dismiss = useCallback(async () => {
    const id = suggestion?.id;
    try {
      if (id) await call(`/api/ai/results/${id}/outcome`, "POST", { outcome: "dismissed" });
    } catch (e) {
      toast({ message: e instanceof Error ? e.message : String(e) });
      return;
    }
    setJob(null);
    setRunError(null);
    setView((v) => (v ? { ...v, suggestion: null } : v));
  }, [suggestion?.id, toast]);

  const accept = useCallback(
    async (parts?: string[]) => {
      const id = suggestion?.id;
      if (!id) return;
      try {
        const out = await call(`/api/ai/results/${id}/outcome`, "POST", { outcome: "accepted", ...(parts ? { parts } : {}) });
        setJob(null);
        setView((v) => (v ? { ...v, suggestion: null } : v));
        // The outbox re-read the issue; pull the new values into the page.
        await refresh();
        const applied = (out.applied as string[] | undefined) ?? [];
        toast({ message: applied.length ? `Accepted: ${applied.join(", ")}.` : "Accepted; nothing had to change." });
      } catch (e) {
        toast({ message: e instanceof Error ? e.message : String(e) });
      }
    },
    [suggestion?.id, toast, refresh],
  );

  // Loading, or AI off with nothing to show: the issue panel stays clean.
  if (!view) {
    return loadError ? <p className="text-[12.5px] text-critical">Could not load the AI suggestion: {loadError}</p> : null;
  }

  const suggestionField = (label: string, s: TriageSuggestion["status"], value: string | undefined) =>
    s ? (
      <Row label={label}>
        <span className="font-medium">{value ?? "missing option"}</span>
        <span className="text-faint"> · {CONFIDENCE[s.confidence] ?? s.confidence}</span>
        <p className="text-[12px] text-muted">{s.reason}</p>
      </Row>
    ) : null;

  const dim = meta.dimensions[0];
  const labelName = (id: string) => meta.labels.find((l) => l.id === id)?.name ?? "missing label";
  const duplicate = suggestion?.result.duplicateOf != null ? byNumber.get(Number(suggestion.result.duplicateOf)) : undefined;

  if (!suggestion && !running && !busy && !error) {
    if (!view.ai.ready) return null;
    return (
      <section aria-label="AI suggestion" data-ai-suggestion className="space-y-1.5">
        <h3 className="text-[12.5px] font-semibold text-muted">AI suggestion</h3>
        <button type="button" onClick={() => void run()} className={btn.outline} data-ai-run>
          <Icon name="zap" size={13} />
          Suggest with AI
        </button>
        <p className="text-[11.5px] text-faint">Sends this issue and its comments to the model you chose. Nothing changes until you accept.</p>
      </section>
    );
  }

  return (
    <section aria-label="AI suggestion" data-ai-suggestion className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-[12.5px] font-semibold text-muted">AI suggestion</h3>
        {suggestion && !suggestion.fresh && (
          <span className="text-[11.5px] font-medium text-warning" data-ai-outdated>
            Outdated · Run again
          </span>
        )}
      </div>

      {running ? (
        <div className="flex items-center gap-2 text-[12.5px] text-muted" role="status">
          <span className="size-3 animate-spin rounded-full border-2 border-line border-t-brand" aria-label="Asking the model" />
          Asking the model…
          <Elapsed since={job?.createdAt ?? null} />
          <button type="button" onClick={() => void cancel()} className={btn.ghost}>
            Cancel
          </button>
        </div>
      ) : error ? (
        <div className="space-y-1.5">
          <p role="alert" className="text-[12.5px] text-critical">
            {error}
          </p>
          <button type="button" onClick={() => void run()} className={btn.outline} data-ai-retry>
            Retry
          </button>
        </div>
      ) : suggestion ? (
        <>
          <p className="text-[13.5px] leading-snug">{suggestion.result.summary}</p>
          <div className="space-y-1">
            {suggestionField("Status", suggestion.result.status, suggestion.result.status ? plainName(option("status", suggestion.result.status.id)?.name ?? "") : undefined)}
            {suggestionField("Priority", suggestion.result.priority, suggestion.result.priority ? plainName(option("priority", suggestion.result.priority.id)?.name ?? "") : undefined)}
            {dim ? suggestionField(dim.name, suggestion.result.dimension, suggestion.result.dimension ? plainName(option(dim.key, suggestion.result.dimension.id)?.name ?? "") : undefined) : null}
            {meta.mapping.sprint ? suggestionField("Release", suggestion.result.sprint, suggestion.result.sprint ? release(suggestion.result.sprint.id)?.title : undefined) : null}
            {(suggestion.result.labels?.length ?? 0) > 0 && (
              <Row label="Labels">
                <span>{suggestion.result.labels!.map((l) => labelName(l.id)).join(", ")}</span>
                <ul className="text-[12px] text-muted">
                  {suggestion.result.labels!.map((l) => (
                    <li key={l.id}>{l.reason}</li>
                  ))}
                </ul>
              </Row>
            )}
            {duplicate && (
              <Row label="Duplicate">
                <button type="button" onClick={() => open(duplicate.number)} className="truncate text-left hover:underline">
                  <span className="text-faint">#{duplicate.number}</span> {duplicate.title}
                </button>
              </Row>
            )}
            {(suggestion.result.flags?.length ?? 0) > 0 && (
              <Row label="Flags">
                <ul className="space-y-0.5">
                  {suggestion.result.flags!.map((f) => (
                    <li key={f.flag}>
                      <span className="font-medium">{FLAG[f.flag] ?? f.flag}</span>
                      <span className="text-muted"> — {f.reason}</span>
                    </li>
                  ))}
                </ul>
              </Row>
            )}
          </div>
          <p className="text-[11.5px] text-faint">
            {suggestion.provider || "AI"}
            {suggestion.model ? ` · ${suggestion.model}` : ""} · {longAgo(suggestion.createdAt)}
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => void accept()}
              className={btn.outline}
              disabled={!meta.writeMode || !suggestion.id || !suggestion.fresh}
              title={!meta.writeMode ? (meta.editOffReason ?? EDITING_OFF) : !suggestion.fresh ? OUTDATED : "Apply this suggestion through the write gate"}
              data-ai-accept
            >
              <Icon name="check" size={13} />
              Accept
            </button>
            <button
              type="button"
              onClick={() => setEditing(new Set(suggestedParts(suggestion.result, meta.mapping.sprint != null)))}
              className={btn.outline}
              disabled={!meta.writeMode || !suggestion.id || !suggestion.fresh}
              title={!meta.writeMode ? (meta.editOffReason ?? EDITING_OFF) : !suggestion.fresh ? OUTDATED : "Adjust the suggestion before accepting"}
              data-ai-edit
            >
              <Icon name="sliders" size={13} />
              Edit
            </button>
            <button type="button" onClick={() => void dismiss()} className={btn.ghost} data-ai-dismiss>
              <Icon name="x" size={13} />
              Dismiss
            </button>
            {!suggestion.fresh && (
              <button type="button" onClick={() => void run()} className={btn.ghost} data-ai-run-again>
                <Icon name="refresh" size={13} />
                Run again
              </button>
            )}
          </div>
          {!meta.writeMode && <p className="text-[11.5px] text-faint">{meta.editOffReason ?? EDITING_OFF}: accepting a GitHub change is off.</p>}
          <Dialog open={editing != null} onClose={() => setEditing(null)} label="Accept suggestion" width={420}>
            {editing && (
              <div className="space-y-3 p-4">
                <p className="text-[13px] font-semibold">Apply which parts?</p>
                <p className="text-[12px] text-muted">The suggestion only changes the parts you keep checked; nothing else is touched.</p>
                <ul className="space-y-1.5">
                  {suggestedParts(suggestion.result, meta.mapping.sprint != null).map((part) => (
                    <li key={part}>
                      <label className="flex items-center gap-2 text-[13px]">
                        <input
                          type="checkbox"
                          className="size-3.5 accent-brand"
                          checked={editing.has(part)}
                          onChange={(e) =>
                            setEditing((cur) => {
                              const next = new Set(cur ?? []);
                              if (e.target.checked) next.add(part);
                              else next.delete(part);
                              return next;
                            })
                          }
                        />
                        <span className="capitalize">{part}</span>
                      </label>
                    </li>
                  ))}
                </ul>
                <div className="flex justify-end gap-1.5">
                  <button type="button" onClick={() => setEditing(null)} className={btn.ghost}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const parts = [...editing];
                      setEditing(null);
                      void accept(parts);
                    }}
                    className={btn.outline}
                    data-ai-apply
                  >
                    <Icon name="check" size={13} /> Apply
                  </button>
                </div>
              </div>
            )}
          </Dialog>
        </>
      ) : (
        <div className="space-y-1.5">
          <p role="alert" className="text-[12.5px] text-critical">
            {view.ai.reason ?? "AI assist is off. Choose a provider in Settings → AI."}
          </p>
          <Link href="/settings#ai" className="text-[12.5px] font-medium text-brand hover:underline">
            Settings → AI
          </Link>
        </div>
      )}
    </section>
  );
}
