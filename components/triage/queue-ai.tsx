"use client";

// "Suggest for this queue" (SPEC §4.9, AI1): asks the model for a triage
// suggestion for every issue of the queue shown, one job each. A batch shows its
// count and confirms above 20 items; it runs one job at a time and can be
// cancelled. Nothing changes on GitHub: the suggestions wait in the issue panels.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Job } from "@/lib/ai/runner";
import { usePoll } from "@/lib/client/poll";
import { Icon } from "../icons";
import { Dialog } from "../ui/dialog";
import { btn } from "../ui/popover";

type Status = { ready: boolean; reason: string | null };
type Phase = "closed" | "status" | "confirm" | "running" | "finished";

/** Above this many issues the batch asks once more before sending (SPEC §4.9). */
export const QUEUE_CONFIRM_ABOVE = 20;

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

  const open = useCallback(async () => {
    setPhase("status");
    setStatus(null);
    setMessage(null);
    setJobs(new Map());
    setBatchId(null);
    try {
      const s = (await call("/api/ai/status", "GET")) as unknown as Status;
      setStatus(s);
      setPhase("confirm");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
      setPhase("finished");
    }
  }, []);

  const close = useCallback(() => setPhase("closed"), []);

  const start = useCallback(async () => {
    setMessage(null);
    try {
      const body = (await call("/api/ai/triage-queue", "POST", { numbers })) as unknown as { batchId: string; jobs: Job[] };
      const map = new Map<string, Job>();
      for (const j of body.jobs) map.set(j.id, j);
      setJobs(map);
      setBatchId(body.batchId);
      setPhase(map.size && [...map.values()].every(finished) ? "finished" : "running");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
      setPhase("finished");
    }
  }, [numbers]);

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
    setMessage(`Cancelled after ${done} of ${numbers.length}.`);
  }, [done, jobs, numbers.length]);

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
              {numbers.length > QUEUE_CONFIRM_ABOVE && (
                <p className="rounded-lg bg-banner-warning px-3 py-2 text-[12.5px] text-warning" data-ai-queue-big>
                  That is a big batch: {numbers.length} issues, so it can take a while. Deska asks each one in turn.
                </p>
              )}
              <div className="flex flex-wrap items-center gap-1.5">
                <button type="button" onClick={() => void start()} className={btn.primary} data-ai-queue-confirm>
                  <Icon name="zap" size={13} />
                  Send {numbers.length} to the model
                </button>
                <button type="button" onClick={close} className={btn.ghost}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {phase === "running" && (
            <div className="space-y-2">
              <p role="status" className="text-[12.5px] text-muted" data-ai-queue-progress>
                {done + failed + cancelled} of {numbers.length} done
                {active.length > 0 ? " · one at a time" : ""}
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
