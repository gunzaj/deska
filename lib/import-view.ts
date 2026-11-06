// What the first-import screen shows (SPEC D5), as a pure function of the status
// payload: which of the three states it is in, the state of each of the four step
// rows, and how much of the count line to draw. The screen renders this and adds
// no judgement of its own, so the Electron-only screen still has a cheap gate.
//
// `lib/import-destination.ts` decides *where* the app goes; this decides what the
// progress screen looks like once it is there. They are separate on purpose.
import type { ImportPhase } from "./sync/import-state";

/** The four steps, in the order the import runs them. */
export const IMPORT_STEPS: readonly ImportPhase[] = ["metadata", "open", "closed", "items"];

/**
 * Every word the screen prints. The screen and the tests both read it, so a reworded
 * line cannot leave a test asserting copy nobody sees any more.
 */
export const IMPORT_COPY = {
  /** Step labels, one per phase in IMPORT_STEPS. */
  steps: {
    metadata: "Project fields, labels and milestones",
    open: "Open issues",
    closed: "Recently closed issues",
    items: "Project items",
  } satisfies Record<ImportPhase, string>,
  /** Nothing copied yet. */
  starting: "Starting…",
  /** Copied before this run began: a relaunch continues, it does not restart. */
  resumed: (issues: number) => `Resuming · ${issues.toLocaleString()} issues already copied`,
  /**
   * A resume that has not re-read its first page yet (it quit during metadata), so
   * there is no number to show. Still a resume, so it must not say "Starting…".
   * Designer owns these words; this is a placeholder that is true, not a choice.
   */
  resumedNoCount: "Resuming…",
  /** The alert's headline when no more specific reason is available (§3.3). */
  failed: "The import stopped",
} as const;

/** `active` animates; `active-idle` is the same step, drawn still (a resume never pulses). */
export type ImportStepState = "todo" | "active" | "active-idle" | "done";

/**
 * Four states, and four is the count: each one is a different sentence on screen, and
 * each is decided by a fact the import reports, not by a number that happens to be
 * non-zero. Do not add a fifth to fix a sentence — a wrong word is fixed in
 * `IMPORT_COPY`, not in this type (Architect, D5).
 *
 * `starting` — nothing copied and nothing to continue; `importing` — this run copied
 * something and there is nothing to resume, so the count line is the truth;
 * `resumed` — this run continued a checkpoint, whether or not it has a count yet, so
 * the copy says it continues; `failed` — the last completed run stopped and nothing is
 * running.
 */
export type ImportViewState = "starting" | "importing" | "resumed" | "failed";

/** Which count line to draw: nothing yet, issues only, or issues plus project items. */
export type ImportProgressKind = "none" | "count" | "items";

export type ImportViewInput = {
  needsInitialImport: boolean;
  running: boolean;
  phase: ImportPhase | null;
  /** Whether this run continued a checkpoint. Written by the import, never inferred. */
  resumed: boolean;
  issues: number;
  items: number;
  itemsTotal: number | null;
  failure: string | null;
};

export type ImportView = { state: ImportViewState; steps: ImportStepState[]; progress: ImportProgressKind };

export function importView(s: ImportViewInput): ImportView {
  // `failure` is the last *completed* run's failure and is cleared only when a run
  // succeeds, so a retry still reports it while it runs: a live Retry button on a
  // run that is already going is the bug that rule prevents.
  // `resumed` is the import's own record of whether it continued a checkpoint
  // (lib/sync/first-import.ts writes it at entry). Counting issues is not the same
  // question: one run counts across its pages, so page 2 of a first import has
  // issues > 0 and nothing to resume.
  // A resume is a resume even with nothing copied yet: a relaunch that quit during
  // the metadata phase has no count to show, and calling that "Starting…" would be a
  // second sentence for the same fact.
  const state: ImportViewState = s.failure && !s.running ? "failed" : s.resumed ? "resumed" : s.issues > 0 ? "importing" : "starting";
  const at = s.phase ? IMPORT_STEPS.indexOf(s.phase) : -1;
  const steps: ImportStepState[] = IMPORT_STEPS.map((_, i) => {
    if (at < 0) return s.issues > 0 ? "done" : "todo";
    if (i < at) return "done";
    // Only a fresh run animates: a resume draws the same step still, so work already
    // copied never looks like it is happening again.
    if (i === at) return state === "resumed" || state === "failed" ? "active-idle" : "active";
    return "todo";
  });
  const progress: ImportProgressKind = state === "starting" ? "none" : s.items > 0 || s.phase === "items" ? "items" : "count";
  return { state, steps, progress };
}
