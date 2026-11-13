"use client";

// Ramble (item 13): record a voice note, transcribe it, let the model split it
// into tasks, review one editable row per task, then create them in one batch.
// Nothing is created until "Create"; a failed create keeps the transcript and the
// rows, and a retry uses the same idempotency key so it never duplicates them.
import { useCallback, useEffect, useRef, useState } from "react";
import type { Job } from "@/lib/ai/runner";
import { MAX_RAMBLE_TASKS, type RambleTaskSuggestion } from "@/lib/ai/ramble";
import { usePoll } from "@/lib/client/poll";
import { PRIORITIES, type Priority } from "@/lib/tasks/model";
import { useTasks } from "./store";
import { useToday } from "./notifications";
import { Icon } from "../icons";
import { Dialog } from "../ui/dialog";
import { btn } from "../ui/popover";
import { useToast } from "../ui/toast";

type Phase = "closed" | "ready" | "recording" | "transcribing" | "parsing" | "review" | "creating";

type Row = {
  key: string;
  title: string;
  dueDate: string;
  dueTime: string;
  priority: Priority;
  projectId: string;
  sectionId: string;
  labelIds: string[];
};

const field = "h-8 w-full rounded-md border border-line bg-field px-2 text-[12.5px] outline-none hover:border-line-field focus:border-focus";
const label = "block text-[11.5px] font-medium text-muted";
const MAX_RECORD_MS = 120_000;

const newRow = (): Row => ({ key: crypto.randomUUID(), title: "", dueDate: "", dueTime: "", priority: 4, projectId: "", sectionId: "", labelIds: [] });

function rowOf(task: RambleTaskSuggestion): Row {
  return {
    key: crypto.randomUUID(),
    title: task.title,
    dueDate: task.dueDate ?? "",
    dueTime: task.dueTime ?? "",
    priority: (task.priority >= 1 && task.priority <= 4 ? task.priority : 4) as Priority,
    projectId: task.projectId ?? "",
    sectionId: task.sectionId ?? "",
    labelIds: task.labelIds ?? [],
  };
}

/** A failed parse keeps the transcript: one row the user can still create. */
function fallbackRow(transcript: string): Row {
  const line = transcript.trim().split("\n")[0]?.trim() ?? "";
  return { ...newRow(), title: line.slice(0, 256) || "New task" };
}

export function RambleDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { projects, labels, sections, reload } = useTasks();
  const { today, now, tz } = useToday();
  const { toast } = useToast();
  const [phase, setPhase] = useState<Phase>("closed");
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [job, setJob] = useState<Job | null>(null);
  const [seconds, setSeconds] = useState(0);
  // One key per review: a retry after a lost answer finds the same tasks.
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // One id per open dialog: an answer from a closed one (a recording stopped by
  // Cancel, a parse that finished after closing) must not land in the next.
  const session = useRef(0);

  const stopRecording = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    if (stopTimer.current) clearTimeout(stopTimer.current);
    timer.current = null;
    stopTimer.current = null;
    const rec = recorder.current;
    if (rec && rec.state !== "inactive") rec.stop();
    for (const track of stream.current?.getTracks() ?? []) track.stop();
    stream.current = null;
  }, []);

  const close = useCallback(() => {
    session.current += 1;
    stopRecording();
    recorder.current = null;
    chunks.current = [];
    setPhase("closed");
    setSeconds(0);
    setError(null);
    setTranscript("");
    setRows([]);
    setJob(null);
    onClose();
  }, [onClose, stopRecording]);

  // Opening starts a new review; closing from anywhere (Cancel, Escape, the
  // backdrop) stops the microphone.
  useEffect(() => {
    if (!open) return;
    session.current += 1;
    setIdempotencyKey(crypto.randomUUID());
    setPhase("ready");
    return () => stopRecording();
  }, [open, stopRecording]);

  const parse = useCallback(
    async (text: string) => {
      const s = session.current;
      pollFailures.current = 0;
      setPhase("parsing");
      setError(null);
      setJob(null);
      try {
        const res = await fetch("/api/ai/ramble", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ transcript: text.trim(), clock: { today, now, tz } }),
        });
        if (s !== session.current) return;
        const body = (await res.json().catch(() => ({}))) as { job?: Job; error?: string };
        if (!res.ok || !body.job) {
          setError(body.error ?? `The transcript could not be read (${res.status}).`);
          setRows([fallbackRow(text)]);
          setPhase("review");
          return;
        }
        setJob(body.job);
        if (body.job.state === "error") {
          setError(body.job.error?.message ?? "The transcript could not be read.");
          setRows([fallbackRow(text)]);
          setPhase("review");
        }
      } catch (e) {
        if (s !== session.current) return;
        setError(e instanceof Error ? e.message : String(e));
        setRows([fallbackRow(text)]);
        setPhase("review");
      }
    },
    [now, today, tz],
  );

  const transcribe = useCallback(async (blob: Blob) => {
    const s = session.current;
    setPhase("transcribing");
    setError(null);
    const form = new FormData();
    // AAC in MP4 is what a local dictation app decodes; OpenAI-compatible
    // endpoints accept it too, so prefer it over WebM/Opus.
    form.append("file", blob, blob.type.includes("mp4") ? "ramble.m4a" : "ramble.webm");
    try {
      const res = await fetch("/api/ai/transcribe", { method: "POST", body: form });
      if (s !== session.current) return;
      const body = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
      if (!res.ok) {
        setError(body.error ?? `Transcription failed (${res.status}).`);
        setPhase("ready");
        return;
      }
      const text = body.text ?? "";
      setTranscript(text);
      if (!text.trim()) {
        setError("No speech was recognized. Type the tasks instead.");
        setPhase("ready");
        return;
      }
      await parse(text);
    } catch (e) {
      if (s !== session.current) return;
      setError(e instanceof Error ? e.message : String(e));
      setPhase("ready");
    }
  }, [parse]);

  const jobId = job?.id ?? null;
  const pollFailures = useRef(0);
  const poll = useCallback(async () => {
    if (!jobId) return;
    const s = session.current;
    try {
      const res = await fetch(`/api/ai/jobs/${jobId}`, { cache: "no-store" });
      if (s !== session.current) return;
      // The job lives in server memory: a restart (or a pruned job) makes it
      // vanish. Say so instead of polling a 404 forever.
      if (res.status === 404) {
        setError("The transcript is no longer being read. Read it again.");
        setRows([fallbackRow(transcript)]);
        setPhase("review");
        return;
      }
      if (!res.ok) {
        // A short outage is retried; a long one falls back to the transcript.
        if (++pollFailures.current >= 10) {
          setError("The transcript could not be read. Read it again.");
          setRows([fallbackRow(transcript)]);
          setPhase("review");
        }
        return;
      }
      pollFailures.current = 0;
      const body = (await res.json()) as { job: Job };
      if (s !== session.current) return;
      setJob(body.job);
      if (body.job.state === "done") {
        const result = body.job.result as { tasks?: RambleTaskSuggestion[] } | null;
        const tasks = result?.tasks ?? [];
        setRows(tasks.length ? tasks.map(rowOf) : [fallbackRow(transcript)]);
        setPhase("review");
      } else if (body.job.state === "error" || body.job.state === "cancelled") {
        setError(body.job.error?.message ?? "The transcript could not be read.");
        setRows([fallbackRow(transcript)]);
        setPhase("review");
      }
    } catch {
      /* a transient poll failure: try again next tick */
    }
  }, [jobId, transcript]);
  usePoll(poll, { every: 800, enabled: phase === "parsing" && !!jobId });

  async function cancelParse() {
    // Cancelling stops the job; the transcript stays for "Read transcript".
    session.current += 1;
    if (jobId) await fetch(`/api/ai/jobs/${jobId}/cancel`, { method: "POST" }).catch(() => null);
    setJob(null);
    setRows([]);
    setError(null);
    setPhase("ready");
  }

  async function record() {
    const s = session.current;
    setError(null);
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (s !== session.current) {
        for (const track of media.getTracks()) track.stop();
        return;
      }
      stream.current = media;
      const type = ["audio/mp4;codecs=mp4a.40.2", "audio/webm;codecs=opus", "audio/webm"].find((t) => MediaRecorder.isTypeSupported(t));
      const rec = new MediaRecorder(media, type ? { mimeType: type } : undefined);
      recorder.current = rec;
      chunks.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size) chunks.current.push(e.data);
      };
      rec.onstop = () => {
        if (s !== session.current) return;
        const blob = new Blob(chunks.current, { type: rec.mimeType || "audio/webm" });
        chunks.current = [];
        void transcribe(blob);
      };
      rec.start();
      setSeconds(0);
      setPhase("recording");
      timer.current = setInterval(() => setSeconds((s) => s + 1), 1000);
      // Two minutes is plenty for a list of tasks; the recording stops itself.
      stopTimer.current = setTimeout(() => stopRecording(), MAX_RECORD_MS);
    } catch {
      // A failed recorder setup must not leave the microphone live.
      for (const track of stream.current?.getTracks() ?? []) track.stop();
      stream.current = null;
      if (s !== session.current) return;
      setError("Microphone access was denied. Allow Deska to use the microphone in System Settings, then try again. You can also type the tasks below.");
      setPhase("ready");
    }
  }

  function edit(key: string, patch: Partial<Row>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function removeRow(key: string) {
    setRows((prev) => prev.filter((r) => r.key !== key));
  }

  async function create() {
    const tasks = rows
      .filter((r) => r.title.trim())
      .map((r) => ({
        title: r.title.trim(),
        dueDate: r.dueDate || null,
        dueTime: r.dueDate && r.dueTime ? r.dueTime : null,
        priority: r.priority,
        projectId: r.projectId || null,
        sectionId: r.projectId && r.sectionId ? r.sectionId : null,
        labels: r.labelIds.flatMap((id) => labels.find((l) => l.id === id)?.name ?? []),
      }));
    if (!tasks.length) {
      setError("Add a title to at least one task.");
      return;
    }
    const s = session.current;
    setPhase("creating");
    setError(null);
    try {
      const res = await fetch("/api/tasks/batch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ idempotencyKey, tasks }),
      });
      if (s !== session.current) return;
      const body = (await res.json().catch(() => ({}))) as { tasks?: unknown[]; error?: string };
      if (!res.ok) {
        setError(body.error ?? `Could not create the tasks (${res.status}).`);
        setPhase("review");
        return;
      }
      toast({ message: `Created ${tasks.length} ${tasks.length === 1 ? "task" : "tasks"}.` });
      await reload();
      close();
    } catch (e) {
      if (s !== session.current) return;
      setError(e instanceof Error ? e.message : String(e));
      setPhase("review");
    }
  }

  const active = projects.filter((p) => !p.archived);
  const sectionsOf = (id: string) => (id ? sections.filter((s) => s.projectId === id).sort((a, b) => a.position - b.position) : []);
  const labelOf = (id: string) => labels.find((l) => l.id === id);
  const title = "Ramble";

  return (
    <Dialog open={open} onClose={close} label={title} width={620}>
      {open && phase === "ready" && (
        <div className="space-y-3 p-4" data-ramble-ready>
          <div>
            <p className="text-[14px] font-semibold">{title}</p>
            <p className="text-[12px] text-faint">Say what you have to do, in your own words. Deska turns it into tasks you can check before creating them.</p>
          </div>
          {error && (
            <p role="alert" className="text-[12.5px] font-medium text-critical">
              {error}
            </p>
          )}
          <button type="button" onClick={() => void record()} className={btn.primary} data-ramble-record>
            <Icon name="mic" size={14} /> Record
          </button>
          <label className={label}>
            Transcript
            <textarea
              aria-label="Transcript"
              value={transcript}
              onChange={(e) => setTranscript(e.target.value)}
              rows={5}
              placeholder="Or type the tasks here, one per line…"
              className="mt-1 w-full rounded-md border border-line bg-field p-2 text-[12.5px] outline-none hover:border-line-field focus:border-focus"
            />
          </label>
          <div className="flex justify-end gap-1.5">
            <button type="button" onClick={close} className={btn.ghost}>
              Cancel
            </button>
            <button type="button" disabled={!transcript.trim()} onClick={() => void parse(transcript)} className={btn.outline} data-ramble-parse>
              Read transcript
            </button>
          </div>
        </div>
      )}

      {open && phase === "recording" && (
        <div className="space-y-3 p-4" data-ramble-recording>
          <p className="text-[14px] font-semibold">Recording…</p>
          <p role="status" className="text-[12.5px] text-muted tabular-nums">
            {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")} · up to two minutes
          </p>
          <button type="button" onClick={stopRecording} className={btn.primary} data-ramble-stop>
            <Icon name="check" size={14} /> Stop and transcribe
          </button>
        </div>
      )}

      {open && phase === "transcribing" && (
        <div className="flex items-center gap-2 p-4 text-[12.5px] text-muted" role="status">
          <span className="size-3 animate-spin rounded-full border-2 border-line border-t-brand" aria-label="Transcribing" />
          Transcribing the recording…
        </div>
      )}

      {open && phase === "parsing" && (
        <div className="flex items-center gap-2 p-4 text-[12.5px] text-muted" role="status">
          <span className="size-3 animate-spin rounded-full border-2 border-line border-t-brand" aria-label="Reading the transcript" />
          Reading the transcript…
          <button type="button" onClick={() => void cancelParse()} className={btn.ghost} data-ramble-cancel>
            Cancel
          </button>
        </div>
      )}

      {open && (phase === "review" || phase === "creating") && (
        <div className="space-y-3 p-4" data-ramble-review>
          <div>
            <h3 className="text-[14px] font-semibold">Review {rows.length === 1 ? "the task" : `${rows.length} tasks`}</h3>
            <p className="text-[12px] text-faint">Edit anything before creating. Nothing is saved until you click Create.</p>
          </div>
          {error && (
            <p role="alert" className="text-[12.5px] font-medium text-critical">
              {error}
            </p>
          )}
          <label className={label}>
            Transcript
            <textarea
              aria-label="Transcript"
              value={transcript}
              onChange={(e) => setTranscript(e.target.value)}
              rows={3}
              className="mt-1 w-full rounded-md border border-line bg-field p-2 text-[12px] outline-none hover:border-line-field focus:border-focus"
            />
          </label>
          <div className="flex justify-end">
            <button type="button" disabled={!transcript.trim() || phase === "creating"} onClick={() => void parse(transcript)} className={btn.ghost} data-ramble-reparse>
              <Icon name="refresh" size={13} /> Read again
            </button>
          </div>
          <div className="max-h-[45vh] space-y-2 overflow-y-auto">
            {rows.map((r, i) => (
              <div key={r.key} className="space-y-1.5 rounded-lg border border-line p-2" data-ramble-row>
                <div className="flex items-center gap-1.5">
                  <input aria-label={`Task ${i + 1} title`} value={r.title} onChange={(e) => edit(r.key, { title: e.target.value })} placeholder="Task" className={`${field} flex-1`} />
                  <button type="button" aria-label={`Remove task ${i + 1}`} onClick={() => removeRow(r.key)} className={btn.icon}>
                    <Icon name="x" size={13} />
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                  <label className={label}>
                    Due date
                    <input aria-label={`Task ${i + 1} due date`} type="date" value={r.dueDate} onChange={(e) => edit(r.key, { dueDate: e.target.value, dueTime: e.target.value ? r.dueTime : "" })} className={`mt-0.5 ${field}`} />
                  </label>
                  <label className={label}>
                    Due time
                    <input aria-label={`Task ${i + 1} due time`} type="time" value={r.dueTime} onChange={(e) => edit(r.key, { dueTime: e.target.value })} disabled={!r.dueDate} className={`mt-0.5 ${field}`} />
                  </label>
                  <label className={label}>
                    Priority
                    <select aria-label={`Task ${i + 1} priority`} value={r.priority} onChange={(e) => edit(r.key, { priority: Number(e.target.value) as Priority })} className={`mt-0.5 ${field}`}>
                      {PRIORITIES.map((p) => (
                        <option key={p.value} value={p.value}>
                          {p.short} · {p.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className={label}>
                    Project
                    <select
                      aria-label={`Task ${i + 1} project`}
                      value={r.projectId}
                      onChange={(e) => edit(r.key, { projectId: e.target.value, sectionId: "" })}
                      className={`mt-0.5 ${field}`}
                    >
                      <option value="">Inbox</option>
                      {active.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                {r.projectId && sectionsOf(r.projectId).length > 0 && (
                  <label className={label}>
                    Section
                    <select aria-label={`Task ${i + 1} section`} value={r.sectionId} onChange={(e) => edit(r.key, { sectionId: e.target.value })} className={`mt-0.5 ${field}`}>
                      <option value="">No section</option>
                      {sectionsOf(r.projectId).map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {r.labelIds.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {r.labelIds.map((id) => {
                      const l = labelOf(id);
                      if (!l) return null;
                      return (
                        <span key={id} className="inline-flex h-5 items-center gap-1 rounded border border-line px-1.5 text-[11px]">
                          {l.name}
                          <button type="button" aria-label={`Remove label ${l.name} from task ${i + 1}`} onClick={() => edit(r.key, { labelIds: r.labelIds.filter((x) => x !== id) })} className="text-faint hover:text-fg">
                            <Icon name="x" size={10} />
                          </button>
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line-soft pt-3">
            <button
              type="button"
              disabled={phase === "creating" || rows.length >= MAX_RAMBLE_TASKS}
              title={rows.length >= MAX_RAMBLE_TASKS ? `A Ramble creates at most ${MAX_RAMBLE_TASKS} tasks` : undefined}
              onClick={() => setRows((prev) => [...prev, newRow()])}
              className={btn.ghost}
              data-ramble-add
            >
              <Icon name="plus" size={13} /> Add task
            </button>
            <div className="flex gap-1.5">
              <button type="button" onClick={close} className={btn.ghost}>
                Cancel
              </button>
              <button type="button" disabled={phase === "creating" || !rows.some((r) => r.title.trim())} onClick={() => void create()} className={btn.primary} data-ramble-create>
                {phase === "creating" ? "Creating…" : `Create ${rows.filter((r) => r.title.trim()).length || ""} ${rows.filter((r) => r.title.trim()).length === 1 ? "task" : "tasks"}`}
              </button>
            </div>
          </div>
          {job?.state === "error" && error && <p className="text-[11.5px] text-faint">The transcript is kept; you can edit the rows and create them, or read it again.</p>}
          {!job && error && <p className="text-[11.5px] text-faint">The transcript is kept; you can edit the row and create it.</p>}
        </div>
      )}
    </Dialog>
  );
}
