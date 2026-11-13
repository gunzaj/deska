"use client";

// "Suggest for this queue" (SPEC §4.9, AI1): asks the model for a triage
// suggestion for every issue of the queue shown, one job each. A batch shows its
// count and confirms above 20 items; it runs one job at a time and can be
// cancelled. Nothing changes on GitHub: the suggestions wait in the issue panels.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Job } from "@/lib/ai/runner";
import { usePoll } from "@/lib/client/poll";
import { Elapsed } from "../ai/elapsed";
import { Icon } from "../icons";
import { Dialog } from "../ui/dialog";
import { btn } from "../ui/popover";

type Status = { ready: boolean; reason: string | null };
type Phase = "closed" | "status" | "confirm" | "starting" | "running" | "finished";

/** Above this many issues the batch asks once more before sending (SPEC §4.9). */
export const QUEUE_CONFIRM_ABOVE = 20;

/** The most issues one batch takes (the route's limit); a longer queue sends its first ones. */
export const QUEUE_MAX = 200;

/** The issues one batch sends: the queue's first `QUEUE_MAX`. */
export function queueBatch(numbers: number[]): number[] {
  return numbers.slice(0, QUEUE_MAX);
}

async function call(url: string, method: "GET" | "POST", body?: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(url, { method, cache: "no-store", headers: body === undefined ? undefined : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const out = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(typeof out.error === "string" ? out.error : `Request failed (${res.status})`);
  return out;
}

const finished = (j: Job) => j.state === "done" || j.state === "error" || j.state === "cancelled";

export function QueueAi({ label, numbers }: { label: string; numbers: number[] }) {
  const [phase, setPhase] = useState<Phase>("closed");
  const [status, setStatus] = useState<Status | null>(null);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [jobs, setJobs] = useState<Map<string, Job>>(new Map());
  const [message, setMessage] = useState<string | null>(null);

  // Whether the dialog is showing: a batch keeps running when it is closed, and
  // an answer that arrives then must not open it again.
  const shown = useRef(false);
  const starting = useRef(false);
  const jobsRef = useRef(jobs);
  jobsRef.current = jobs;

  const open = useCallback(async () => {
    shown.current = true;
    // A batch from before the dialog was closed is still going: show it, with
    // its Cancel, instead of forgetting it and offering to send the queue again.
    if (starting.current) return setPhase("starting");
    if (batch.current && [...jobsRef.current.values()].some((j) => !finished(j))) return setPhase("running");
    setPhase("status");
    setStatus(null);
    setMessage(null);
    setJobs(new Map());
    setBatchId(null);
    try {
      const s = (await call("/api/ai/status", "GET")) as unknown as Status;
      if (!shown.current) return;
      setStatus(s);
      setPhase("confirm");
    } catch (e) {
      if (!shown.current) return;
      setMessage(e instanceof Error ? e.message : String(e));
      setPhase("finished");
    }
  }, []);

  const close = useCallback(() => {
    shown.current = false;
    setPhase("closed");
  }, []);

  const sending = useMemo(() => queueBatch(numbers), [numbers]);

  const start = useCallback(async () => {
    // One batch per click: while the server builds the inputs (a read per
    // issue) a second click used to queue every issue again.
    if (starting.current) return;
    starting.current = true;
    setMessage(null);
    setPhase("starting");
    try {
      const body = (await call("/api/ai/triage-queue", "POST", { numbers: sending })) as unknown as { batchId: string; jobs: Job[] };
      const map = new Map<string, Job>();
      for (const j of body.jobs) map.set(j.id, j);
      setJobs(map);
      setBatchId(body.batchId);
      // Closed meanwhile: the batch runs on, and opening the dialog shows it.
      if (shown.current) setPhase(map.size && [...map.values()].every(finished) ? "finished" : "running");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
      if (shown.current) setPhase("finished");
    } finally {
      starting.current = false;
    }
  }, [sending]);

  const batch = useRef<string | null>(null);
  batch.current = batchId;
  const poll = useCallback(async () => {
    const id = batch.current;
    if (!id) return;
    const body = (await call(`/api/ai/jobs?batch=${encodeURIComponent(id)}`, "GET")) as unknown as { jobs: Job[] };
    setJobs((prev) => {
      const next = new Map(prev);
      for (const j of body.jobs) next.set(j.id, j);
      return next;
    });
  }, []);
  const running = phase === "running";
  usePoll(poll, { every: 1000, enabled: running });

  const list = useMemo(() => [...jobs.values()], [jobs]);
  const done = list.filter((j) => j.state === "done").length;
  const failed = list.filter((j) => j.state === "error").length;
  const cancelled = list.filter((j) => j.state === "cancelled").length;
  const active = list.filter((j) => j.state === "queued" || j.state === "running");
  // Every job has ended: the batch says how it went and stops polling.
  useEffect(() => {
    if (phase === "running" && list.length > 0 && list.every(finished)) setPhase("finished");
  }, [phase, list]);

  const cancel = useCallback(async () => {
    await Promise.all(
      [...jobs.values()]
        .filter((j) => j.state === "queued" || j.state === "running")
        .map((j) => call(`/api/ai/jobs/${j.id}/cancel`, "POST").catch(() => null)),
    );
    setPhase("finished");
    setMessage(`Cancelled after ${done} of ${jobs.size}.`);
  }, [done, jobs]);

  const title = `Suggest for this queue`;
  return (
    <>
      <button type="button" onClick={() => void open()} className={btn.outline} disabled={numbers.length === 0} title={numbers.length ? "Ask the model for one suggestion per issue" : "This queue is empty"} data-ai-queue>
        <Icon name="zap" size={13} />
        {title}
      </button>
      <Dialog open={phase !== "closed"} onClose={close} label={title} width={460}>
        <div className="space-y-3 p-4" data-ai-queue-dialog>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[14px] font-semibold">{title}</p>
              <p className="text-[12px] text-faint">
                {label} · {numbers.length} {numbers.length === 1 ? "issue" : "issues"}
              </p>
            </div>
            <button type="button" onClick={close} aria-label="Close" className={btn.icon}>
              <Icon name="x" size={15} />
            </button>
          </div>

          {phase === "status" && <p role="status" className="text-[12.5px] text-muted">Checking AI assist…</p>}

          {phase === "confirm" && status && !status.ready && (
            <div className="space-y-2">
              <p role="alert" className="text-[12.5px] text-critical">
                {status.reason ?? "AI assist is off. Choose a provider in Settings → AI."}
              </p>
              <p className="text-[12px] text-faint">Nothing is sent until AI is on and Test connection passed.</p>
              <button type="button" onClick={close} className={btn.outline}>
                Close
              </button>
            </div>
          )}

          {phase === "confirm" && status?.ready && (
            <div className="space-y-2">
              <p className="text-[12.5px] text-muted">
                One suggestion per issue, one at a time. Each issue and its comments go to the model you chose; nothing changes on GitHub.
              </p>
              {sending.length > QUEUE_CONFIRM_ABOVE && (
                <p className="rounded-lg bg-banner-warning px-3 py-2 text-[12.5px] text-warning" data-ai-queue-big>
                  That is a big batch: {sending.length} issues, so it can take a while. Deska asks each one in turn.
                </p>
              )}
              {numbers.length > sending.length && (
                <p className="text-[12.5px] text-muted" data-ai-queue-capped>
                  Only the first {sending.length} of {numbers.length} issues are sent. Run it again for the rest once these are triaged.
                </p>
              )}
              <div className="flex flex-wrap items-center gap-1.5">
                <button type="button" onClick={() => void start()} className={btn.primary} data-ai-queue-confirm>
                  <Icon name="zap" size={13} />
                  Send {sending.length} to the model
                </button>
                <button type="button" onClick={close} className={btn.ghost}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {phase === "starting" && (
            <p role="status" className="text-[12.5px] text-muted" data-ai-queue-starting>
              Reading {sending.length} {sending.length === 1 ? "issue" : "issues"}…
            </p>
          )}

          {phase === "running" && (
            <div className="space-y-2">
              <p role="status" className="text-[12.5px] text-muted" data-ai-queue-progress>
                {done + failed + cancelled} of {list.length} done
                {active.length > 0 ? " · one at a time" : ""}
                {list[0] ? <> · <Elapsed since={list[0].createdAt} /></> : null}
              </p>
              <button type="button" onClick={() => void cancel()} className={btn.outline} data-ai-queue-cancel>
                <Icon name="x" size={13} />
                Cancel batch
              </button>
            </div>
          )}

          {phase === "finished" && (
            <div className="space-y-2">
              <p role="status" className="text-[12.5px] text-muted" data-ai-queue-done>
                {message ??
                  (failed > 0
                    ? `${done} suggestions ready, ${failed} failed. Open an issue to review them.`
                    : `${done} suggestions ready. Open an issue to review them.`)}
              </p>
              <button type="button" onClick={close} className={btn.outline}>
                Close
              </button>
            </div>
          )}
        </div>
      </Dialog>
    </>
  );
}
