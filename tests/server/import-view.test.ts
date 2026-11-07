// SPEC D5: the first-import screen's three states, its four step rows and its
// count line, derived from the /api/sync-status payload. The screen is
// Electron-only, so this is the gate it gets.
import { describe, expect, it } from "vitest";
import { IMPORT_COPY, IMPORT_STEPS, importView, type ImportViewInput } from "@/lib/import-view";

function input(over: Partial<ImportViewInput> = {}): ImportViewInput {
  return { needsInitialImport: true, running: true, phase: "open", resumed: false, issues: 0, items: 0, itemsTotal: null, failure: null, ...over };
}

describe("importView", () => {
  it("is starting before anything is copied, with every step still to do", () => {
    expect(importView(input({ phase: null }))).toEqual({
      state: "starting",
      steps: ["todo", "todo", "todo", "todo"],
      progress: "none",
      line: { kind: "starting", copy: IMPORT_COPY.starting },
    });
    // The metadata phase is the first real step: it is the one that animates.
    expect(importView(input({ phase: "metadata" })).steps).toEqual(["active", "todo", "todo", "todo"]);
  });

  it("is resumed when the run continued a checkpoint, and the step in progress does not animate", () => {
    const v = importView(input({ resumed: true, issues: 4812, phase: "closed" }));
    expect(v.state).toBe("resumed");
    // Everything before the current step is the record of how far it got; the
    // current step is drawn still, so a relaunch never looks like a restart.
    expect(v.steps).toEqual(["done", "done", "active-idle", "todo"]);
    expect(v.progress).toBe("count");
  });

  it("is importing, not resuming, when one fresh run has copied issues", () => {
    // The trigger, pinned: a first import counts across its pages, so page 2 has
    // issues > 0 with nothing to resume. Only the import's own record says which.
    const fresh = importView(input({ resumed: false, issues: 100, phase: "open" }));
    expect(fresh.state).toBe("importing");
    expect(fresh.steps).toEqual(["done", "active", "todo", "todo"]);
    expect(fresh.progress).toBe("count");

    const resumed = importView(input({ resumed: true, issues: 100, phase: "open" }));
    expect(resumed.state).toBe("resumed");
    expect(resumed.steps).toEqual(["done", "active-idle", "todo", "todo"]);
  });

  it("is still resumed when a relaunch has nothing to show yet", () => {
    // A relaunch that quit during the metadata phase: nothing copied, so there is no
    // number, but it is continuing rather than starting. The state stays `resumed` and
    // the copy drops the count (Architect: fix the sentence, never add a state).
    const v = importView(input({ resumed: true, issues: 0, phase: "metadata" }));
    expect(v.state).toBe("resumed");
    expect(v.steps).toEqual(["active-idle", "todo", "todo", "todo"]);
    expect(v.progress).toBe("count");
  });

  it("is failed when the last completed run failed and nothing is running", () => {
    const v = importView(input({ issues: 4812, phase: "items", failure: "offline", running: false }));
    expect(v.state).toBe("failed");
    // The step list stays: it is the record of how far the import got.
    expect(v.steps).toEqual(["done", "done", "done", "active-idle"]);
  });

  it("is resumed while a failed import is being retried", () => {
    // `failure` is the last completed run's and is cleared only on success
    // (lib/sync/service.ts), so a live Retry button would sit on a running import.
    const v = importView(input({ resumed: true, issues: 4812, phase: "items", failure: "offline", running: true }));
    expect(v.state).toBe("resumed");
    expect(v.progress).toBe("items");
  });

  it("draws project items only once there are some", () => {
    expect(importView(input({ issues: 12, phase: "open" })).progress).toBe("count");
    expect(importView(input({ issues: 12, phase: "items" })).progress).toBe("items");
    expect(importView(input({ issues: 12, items: 3, itemsTotal: 40 })).progress).toBe("items");
  });

  it("keeps the failure state out of the progress bar", () => {
    // The phase survives a failure (the checkpoint is cleared only on success), so a
    // bar drawn off `phase` would sit at its last percentage under the alert.
    const v = importView(input({ resumed: true, issues: 120, items: 60, itemsTotal: 100, phase: "items", failure: "offline", running: false }));
    expect(v.state).toBe("failed");
    expect(v.progress).toBe("items");
    // The screen gates the bar on `state !== "failed"`; the steps still record how far it got.
    expect(v.steps).toEqual(["done", "done", "done", "active-idle"]);
  });

  it("names one step per phase, so the labels and the rows cannot drift apart", () => {
    for (const phase of IMPORT_STEPS) expect(IMPORT_COPY.steps[phase]).toBeTruthy();
    expect(Object.keys(IMPORT_COPY.steps).sort()).toEqual([...IMPORT_STEPS].sort());
  });

  it("decides which sentence the count line shows, words included", () => {
    // QA's finding, twice over: the component first picked the kind with an `issues > 0`
    // of its own, then mapped the kind to a string. Both were invisible to this suite.
    // The sentence now travels in `line`, so a swapped pair of resume branches fails here.
    expect(importView(input({ resumed: true, issues: 0, phase: "metadata" })).line).toEqual({
      kind: "resume-none",
      copy: IMPORT_COPY.resumedNoCount,
    });
    expect(importView(input({ resumed: true, issues: 1204, phase: "closed" })).line).toEqual({
      kind: "resume",
      copy: IMPORT_COPY.resumed(1204),
      issues: 1204,
    });
    expect(importView(input({ issues: 12, phase: "open" })).line).toEqual({ kind: "count", issues: 12, items: null, itemsTotal: null });
    expect(importView(input({ issues: 12, items: 3, itemsTotal: 40, phase: "items" })).line).toEqual({ kind: "count", issues: 12, items: 3, itemsTotal: 40 });
    // A stopped run shows its count, not "Resuming": the alert above it carries the
    // failure, and a resume sentence would read as if it were still going. Unchanged
    // from before this refactor — pinned so it stays a decision rather than a default.
    expect(importView(input({ resumed: true, issues: 60, phase: "items", failure: "offline", running: false })).line).toEqual({
      kind: "count",
      issues: 60,
      items: 0,
      itemsTotal: null,
    });
  });

  it("keeps the progress bar independent of the sentence", () => {
    // The bar is drawn from `progress`, not `line`: a resume in the items phase has no
    // count sentence and still needs the bar.
    const v = importView(input({ resumed: true, issues: 1204, items: 60, itemsTotal: 100, phase: "items" }));
    expect(v.line).toEqual({ kind: "resume", copy: IMPORT_COPY.resumed(1204), issues: 1204 });
    expect(v.progress).toBe("items");
  });

  it("carries the sentence, so the screen cannot map a kind to the wrong words", () => {
    // The two resume sentences are the pair that got swapped: same kind of run, different
    // count. If `line.copy` were derived anywhere but here, this would not hold.
    const none = importView(input({ resumed: true, issues: 0, phase: "metadata" })).line;
    const some = importView(input({ resumed: true, issues: 9, phase: "closed" })).line;
    expect(none.kind === "resume-none" && none.copy).toBe("Resuming · no issues copied yet");
    expect(some.kind === "resume" && some.copy).toBe("Resuming · 9 issues already copied");
    // Both start the same way, and neither is the starting sentence.
    expect(none.kind === "resume-none" && none.copy.startsWith("Resuming")).toBe(true);
    expect(some.kind === "resume" && some.copy.startsWith("Resuming")).toBe(true);
  });

  it("says a resume continues rather than restarts", () => {
    expect(IMPORT_COPY.starting).toBe("Starting…");
    expect(IMPORT_COPY.resumed(4812)).toBe("Resuming · 4,812 issues already copied");
    // Exact, not "different from starting": a reword has to be deliberate, and the
    // pair keeps the same shape so only the count clause changes.
    expect(IMPORT_COPY.resumedNoCount).toBe("Resuming · no issues copied yet");
    expect(IMPORT_COPY.resumed(0)).toBe("Resuming · 0 issues already copied");
  });
});
