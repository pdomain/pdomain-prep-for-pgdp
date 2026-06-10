/**
 * postImport invariant tests.
 *
 * Key invariants:
 * 1. Job lifecycle: thumbnails → ingest → done → settled (emitProjectMutated).
 * 2. Job lifecycle: cancelled path fires removeJobRow.
 * 3. Pa placement: indexWasFast=true → redirected.
 * 4. Pb placement: indexWasFast=false → anchored.
 * 5. BACK_TO_PROJECTS from redirected goes to anchored.
 * 6. JobsDrawer: COLLAPSE_DRAWER / EXPAND_DRAWER.
 * 7. JobsPill: OPEN_JOBS / CLOSE_JOBS.
 * 8. settled state calls onProjectMutated (PROJECT_MUTATED equivalent).
 */

import { describe, it, expect, vi } from "vitest";
import { createActor, type StateValue } from "xstate";
import { postImportMachine, type PostImportInput } from "./postImport";
import type { ImportJob } from "@/mocks/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeJob(overrides: Partial<ImportJob> = {}): ImportJob {
  return {
    id: "job-1",
    project: "proj-1",
    projectId: "proj-1",
    state: "running",
    phase: "thumbnails",
    pct: 0,
    cancelable: true,
    ...overrides,
  };
}

function makeInput(overrides: Partial<PostImportInput> = {}): PostImportInput {
  return {
    projectId: "proj-1",
    initialJob: makeJob(),
    indexWasFast: false,
    ...overrides,
  };
}

function startActor(overrides: Partial<PostImportInput> = {}) {
  const actor = createActor(postImportMachine, { input: makeInput(overrides) });
  actor.start();
  return actor;
}

/**
 * Helper for checking a parallel sub-state by region name.
 * XState v5 parallel state values are nested objects.
 */
function regionIs(
  stateValue: StateValue,
  region: string,
  subState: string,
): boolean {
  if (typeof stateValue !== "object") return false;
  const regionValue = (stateValue as Record<string, StateValue>)[region];
  if (typeof regionValue === "string") return regionValue === subState;
  if (typeof regionValue === "object") {
    // Sub-compound state: check top-level key
    return (
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
      Object.keys(regionValue as Record<string, StateValue>)[0] === subState
    );
  }
  return false;
}

// ---------------------------------------------------------------------------
// Placement — Pa (redirected) vs Pb (anchored)
// ---------------------------------------------------------------------------

describe("postImport — placement", () => {
  it("indexWasFast=false → anchored placement", () => {
    const actor = startActor({ indexWasFast: false });
    expect(regionIs(actor.getSnapshot().value, "placement", "anchored")).toBe(
      true,
    );
    actor.stop();
  });

  it("indexWasFast=true → redirected placement", () => {
    const actor = startActor({ indexWasFast: true });
    expect(regionIs(actor.getSnapshot().value, "placement", "redirected")).toBe(
      true,
    );
    actor.stop();
  });

  it("BACK_TO_PROJECTS from redirected moves to anchored", () => {
    const actor = startActor({ indexWasFast: true });
    actor.send({ type: "BACK_TO_PROJECTS" });
    expect(regionIs(actor.getSnapshot().value, "placement", "anchored")).toBe(
      true,
    );
    expect(actor.getSnapshot().context.anchorId).toBeNull();
    actor.stop();
  });

  it("OPEN_IMPORTING_ROW from anchored moves to redirected", () => {
    const actor = startActor({ indexWasFast: false });
    actor.send({ type: "OPEN_IMPORTING_ROW" });
    expect(regionIs(actor.getSnapshot().value, "placement", "redirected")).toBe(
      true,
    );
    actor.stop();
  });

  it("SELECT_PROJECT from anchored sets anchorId", () => {
    const actor = startActor({ indexWasFast: false });
    actor.send({ type: "SELECT_PROJECT", projectId: "other-proj" });
    expect(actor.getSnapshot().context.anchorId).toBe("other-proj");
    actor.stop();
  });
});

// ---------------------------------------------------------------------------
// Import job lifecycle: thumbnails → ingest → done → settled
// ---------------------------------------------------------------------------

describe("postImport — job lifecycle", () => {
  it("starts in importJob.thumbnails", () => {
    const actor = startActor();
    expect(regionIs(actor.getSnapshot().value, "importJob", "thumbnails")).toBe(
      true,
    );
    actor.stop();
  });

  it("JOB_PROGRESS in thumbnails updates job pct/phase", () => {
    const actor = startActor();
    actor.send({ type: "JOB_PROGRESS", pct: 25, phase: "thumbnails" });
    expect(actor.getSnapshot().context.job.pct).toBe(25);
    expect(actor.getSnapshot().context.job.phase).toBe("thumbnails");
    actor.stop();
  });

  it("PHASE_PUSH with ingest phase moves to ingest state", () => {
    const actor = startActor();
    actor.send({ type: "PHASE_PUSH", phase: "ingest.start", pct: 50 });
    expect(regionIs(actor.getSnapshot().value, "importJob", "ingest")).toBe(
      true,
    );
    expect(actor.getSnapshot().context.job.phase).toBe("ingest.start");
    actor.stop();
  });

  it("PHASE_PUSH with state=done from ingest moves to done", () => {
    const actor = startActor();
    actor.send({ type: "PHASE_PUSH", phase: "ingest.start", pct: 50 });
    actor.send({ type: "PHASE_PUSH", phase: "ingest.finish", state: "done" });
    expect(regionIs(actor.getSnapshot().value, "importJob", "done")).toBe(true);
    actor.stop();
  });

  it("done state adds a completion toast", () => {
    const actor = startActor();
    actor.send({ type: "PHASE_PUSH", phase: "ingest.start", pct: 50 });
    actor.send({ type: "PHASE_PUSH", phase: "ingest.finish", state: "done" });
    expect(actor.getSnapshot().context.toasts).toHaveLength(1);
    expect(actor.getSnapshot().context.toasts[0]?.project).toBe("proj-1");
    actor.stop();
  });

  it("done.job state has pct=100", () => {
    const actor = startActor();
    actor.send({ type: "PHASE_PUSH", phase: "ingest.start", pct: 50 });
    actor.send({ type: "PHASE_PUSH", phase: "ingest.finish", state: "done" });
    expect(actor.getSnapshot().context.job.pct).toBe(100);
    expect(actor.getSnapshot().context.job.state).toBe("done");
    actor.stop();
  });

  it("DISMISS_TOAST from done moves importJob to settled", () => {
    const onProjectMutated = vi.fn();
    const actor = startActor({ onProjectMutated });
    actor.send({ type: "PHASE_PUSH", phase: "ingest.start", pct: 50 });
    actor.send({ type: "PHASE_PUSH", phase: "ingest.finish", state: "done" });
    const toastId = actor.getSnapshot().context.toasts[0]?.id;
    expect(toastId).toBeDefined();
    actor.send({ type: "DISMISS_TOAST", toastId: toastId! });
    expect(regionIs(actor.getSnapshot().value, "importJob", "settled")).toBe(
      true,
    );
    actor.stop();
  });

  it("settled state calls onProjectMutated (PROJECT_MUTATED equivalent)", () => {
    const onProjectMutated = vi.fn();
    const actor = startActor({ onProjectMutated });
    actor.send({ type: "PHASE_PUSH", phase: "ingest.start", pct: 50 });
    actor.send({ type: "PHASE_PUSH", phase: "ingest.finish", state: "done" });
    const toastId = actor.getSnapshot().context.toasts[0]?.id;
    expect(toastId).toBeDefined();
    actor.send({ type: "DISMISS_TOAST", toastId: toastId! });
    expect(onProjectMutated).toHaveBeenCalledOnce();
    actor.stop();
  });
});

// ---------------------------------------------------------------------------
// Import job lifecycle: cancellation
// ---------------------------------------------------------------------------

describe("postImport — job cancellation", () => {
  it("CANCEL_JOB for cancelable job moves to cancelled", () => {
    const actor = startActor({
      initialJob: makeJob({ cancelable: true }),
    });
    actor.send({ type: "CANCEL_JOB", jobId: "job-1" });
    expect(regionIs(actor.getSnapshot().value, "importJob", "cancelled")).toBe(
      true,
    );
    actor.stop();
  });

  it("cancelled calls onProjectMutated (removeJobRow)", () => {
    const onProjectMutated = vi.fn();
    const actor = startActor({
      initialJob: makeJob({ cancelable: true }),
      onProjectMutated,
    });
    actor.send({ type: "CANCEL_JOB", jobId: "job-1" });
    expect(onProjectMutated).toHaveBeenCalledOnce();
    actor.stop();
  });

  it("CANCEL_JOB for non-cancelable job is ignored", () => {
    const actor = startActor({
      initialJob: makeJob({ cancelable: false }),
    });
    actor.send({ type: "CANCEL_JOB", jobId: "job-1" });
    // Should stay in thumbnails
    expect(regionIs(actor.getSnapshot().value, "importJob", "thumbnails")).toBe(
      true,
    );
    actor.stop();
  });
});

// ---------------------------------------------------------------------------
// JobsDrawer
// ---------------------------------------------------------------------------

describe("postImport — jobsDrawer", () => {
  it("starts expanded", () => {
    const actor = startActor();
    expect(regionIs(actor.getSnapshot().value, "jobsDrawer", "expanded")).toBe(
      true,
    );
    actor.stop();
  });

  it("COLLAPSE_DRAWER → collapsed", () => {
    const actor = startActor();
    actor.send({ type: "COLLAPSE_DRAWER" });
    expect(regionIs(actor.getSnapshot().value, "jobsDrawer", "collapsed")).toBe(
      true,
    );
    actor.stop();
  });

  it("EXPAND_DRAWER from collapsed → expanded", () => {
    const actor = startActor();
    actor.send({ type: "COLLAPSE_DRAWER" });
    actor.send({ type: "EXPAND_DRAWER" });
    expect(regionIs(actor.getSnapshot().value, "jobsDrawer", "expanded")).toBe(
      true,
    );
    actor.stop();
  });
});

// ---------------------------------------------------------------------------
// JobsPill
// ---------------------------------------------------------------------------

describe("postImport — jobsPill", () => {
  it("starts closed", () => {
    const actor = startActor();
    expect(regionIs(actor.getSnapshot().value, "jobsPill", "closed")).toBe(
      true,
    );
    actor.stop();
  });

  it("OPEN_JOBS → open", () => {
    const actor = startActor();
    actor.send({ type: "OPEN_JOBS" });
    expect(regionIs(actor.getSnapshot().value, "jobsPill", "open")).toBe(true);
    actor.stop();
  });

  it("CLOSE_JOBS from open → closed", () => {
    const actor = startActor();
    actor.send({ type: "OPEN_JOBS" });
    actor.send({ type: "CLOSE_JOBS" });
    expect(regionIs(actor.getSnapshot().value, "jobsPill", "closed")).toBe(
      true,
    );
    actor.stop();
  });
});

// ---------------------------------------------------------------------------
// OPEN_PROJECT navigation
// ---------------------------------------------------------------------------

describe("postImport — OPEN_PROJECT navigation", () => {
  it("OPEN_PROJECT in done state calls onNavigateToProject", () => {
    const onNavigateToProject = vi.fn();
    const actor = startActor({ onNavigateToProject });
    actor.send({ type: "PHASE_PUSH", phase: "ingest.start", pct: 50 });
    actor.send({ type: "PHASE_PUSH", phase: "ingest.finish", state: "done" });
    actor.send({ type: "OPEN_PROJECT" });
    expect(onNavigateToProject).toHaveBeenCalledWith("proj-1");
    actor.stop();
  });

  it("OPEN_PROJECT in anchored placement calls onNavigateToProject", () => {
    const onNavigateToProject = vi.fn();
    const actor = startActor({
      indexWasFast: false,
      onNavigateToProject,
    });
    // OPEN_PROJECT in anchored state (no jobDone guard in anchored)
    actor.send({ type: "OPEN_PROJECT", projectId: "proj-1" });
    expect(onNavigateToProject).toHaveBeenCalledWith("proj-1");
    actor.stop();
  });
});
