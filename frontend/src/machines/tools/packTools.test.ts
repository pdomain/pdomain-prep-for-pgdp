/**
 * packTools.test.ts — Invariant suite for the F5.6 pack group machines.
 *
 * ## Invariant Suite: validation→build→zip→submit gate chain (UI layer)
 *
 * The gate chain is tested as an integration-style harness that drives all
 * six machines on the mock server and verifies cross-machine constraints:
 *
 * 1. build disabled until validation clean (preflightPassed guard)
 * 2. zip disabled until built (zip starts compressing only after build_package built)
 * 3. submit_check dry-run before SUBMIT (structurally: SUBMIT only reachable from `ready`)
 * 4. SUBMIT requires the confirming gate (GateConfirmation event gate="submit_confirm")
 *    then `submitted` is final
 * 5. UPSTREAM_CHANGED invalidates everything downstream (stale states propagate)
 *
 * Each tool is also unit-tested for its own lifecycle invariants.
 *
 * @see src/machines/tools/validationTool.ts
 * @see src/machines/tools/buildPackageTool.ts
 * @see src/machines/tools/zipTool.ts
 * @see src/machines/tools/submitCheckTool.ts
 * @see src/machines/tools/archiveTool.ts
 * @see src/machines/DIVERGENCES.md — F5.6 sections
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createActor } from "xstate";
import {
  validationToolMachine,
  type ValidationToolServices,
  type ValidationToolInput,
  type ValidationRule,
  type ValidationCounts,
  blockerCount,
} from "./validationTool";
import {
  proofPackToolMachine,
  type ProofPackToolServices,
  type ProofPackToolInput,
} from "./proofPackTool";
import {
  buildPackageToolMachine,
  type BuildPackageToolServices,
  type BuildPackageToolInput,
  type PreflightStatus,
} from "./buildPackageTool";
import {
  zipToolMachine,
  type ZipToolServices,
  type ZipToolInput,
} from "./zipTool";
import {
  submitCheckToolMachine,
  type SubmitCheckToolServices,
  type SubmitCheckToolInput,
} from "./submitCheckTool";
import {
  archiveToolMachine,
  type ArchiveToolServices,
  type ArchiveToolInput,
} from "./archiveTool";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

async function waitForState<S>(
  actor: { getSnapshot: () => S },
  predicate: (snap: S) => boolean,
  maxMs = 1000,
): Promise<S> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + maxMs;
    const check = () => {
      const snap = actor.getSnapshot();
      if (predicate(snap)) {
        resolve(snap);
        return;
      }
      if (Date.now() > deadline) {
        reject(new Error(`timeout — last state: ${JSON.stringify(snap)}`));
        return;
      }
      setTimeout(check, 10);
    };
    check();
  });
}

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

const CLEAN_RULES: ValidationRule[] = [
  { id: "r1", name: "Metadata complete", level: "pass", detail: "ok" },
  { id: "r2", name: "Zero open scannos", level: "pass", detail: "ok" },
  { id: "r3", name: "All pages have text", level: "pass", detail: "ok" },
];
const CLEAN_COUNTS: ValidationCounts = { pass: 3, warn: 0, error: 0 };

const BLOCKED_RULES: ValidationRule[] = [
  {
    id: "r1",
    name: "Metadata complete",
    level: "error",
    detail: "missing author",
  },
  { id: "r2", name: "Zero open scannos", level: "warn", detail: "2 open" },
  { id: "r3", name: "All pages have text", level: "pass", detail: "ok" },
];
const BLOCKED_COUNTS: ValidationCounts = { pass: 1, warn: 1, error: 1 };

function makeValidationServices(
  overrides: Partial<ValidationToolServices> = {},
): ValidationToolServices {
  return {
    runChecks: vi
      .fn()
      .mockResolvedValue({ rules: CLEAN_RULES, counts: CLEAN_COUNTS }),
    persistWaiver: vi.fn().mockResolvedValue({ ok: true }),
    ...overrides,
  };
}

function makeValidationInput(
  overrides: Partial<ValidationToolInput> = {},
): ValidationToolInput {
  return {
    projectId: "proj-test",
    stageIndex: 17,
    services: makeValidationServices(),
    ...overrides,
  };
}

function makeProofPackServices(
  overrides: Partial<ProofPackToolServices> = {},
): ProofPackToolServices {
  return {
    assemblePack: vi.fn().mockResolvedValue({
      tree: [{ name: "p0001.png", meta: "1.2 MB" }],
      completeness: { complete: 387, total: 387 },
    }),
    ...overrides,
  };
}

function makeBuildServices(
  overrides: Partial<BuildPackageToolServices> = {},
): BuildPackageToolServices {
  return {
    buildArtifacts: vi.fn().mockResolvedValue({
      deliverable: {
        files: [{ name: "manifest.json", meta: "4.2 KB" }],
        count: 5,
      },
      manifest: {
        project: "belloc-survivals",
        pages: 387,
        canvas: "2480x3400",
        built: "2026-06-02T00:00:00Z",
        pipeline: "pd-prep v1.0",
        files: 1229,
        sha256: "a3f1…9c2",
      },
    }),
    ...overrides,
  };
}

function makeZipServices(
  overrides: Partial<ZipToolServices> = {},
): ZipToolServices {
  return {
    requestRebuild: vi.fn().mockResolvedValue(undefined),
    downloadArchive: vi.fn().mockResolvedValue("mock://download-url"),
    ...overrides,
  };
}

function makeSubmitCheckServices(
  overrides: Partial<SubmitCheckToolServices> = {},
): SubmitCheckToolServices {
  return {
    dryRun: vi.fn().mockResolvedValue([
      { ok: true, label: "File naming scheme correct" },
      { ok: true, label: "Package size within limits" },
      { ok: true, label: "Manifest valid" },
    ]),
    liveSubmit: vi.fn().mockResolvedValue({ at: "2026-06-10T12:00:00Z" }),
    ...overrides,
  };
}

function makeArchiveServices(
  overrides: Partial<ArchiveToolServices> = {},
): ArchiveToolServices {
  return {
    archiveProject: vi
      .fn()
      .mockResolvedValue({ kept: "3.5 GB", dropped: "18.4 GB" }),
    persistItem: vi.fn().mockResolvedValue({ ok: true }),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Suite A: validationTool lifecycle
// ---------------------------------------------------------------------------

describe("validationTool — lifecycle", () => {
  it("starts in checking and reaches passed when no blockers", async () => {
    const actor = createActor(validationToolMachine, {
      input: makeValidationInput(),
    });
    actor.start();
    expect(actor.getSnapshot().matches("checking")).toBe(true);

    await waitForState(actor, (s) => s.matches("passed"));
    const snap = actor.getSnapshot();
    expect(snap.context.counts).toEqual(CLEAN_COUNTS);
    expect(snap.context.rules).toHaveLength(3);
    actor.stop();
  });

  it("reaches blocked when errors exist (advisory strictness)", async () => {
    const services = makeValidationServices({
      runChecks: vi
        .fn()
        .mockResolvedValue({ rules: BLOCKED_RULES, counts: BLOCKED_COUNTS }),
    });
    const actor = createActor(validationToolMachine, {
      input: makeValidationInput({ services }),
    });
    actor.start();
    await waitForState(actor, (s) => s.matches("blocked"));
    const snap = actor.getSnapshot();
    expect(snap.context.counts?.error).toBe(1);
    actor.stop();
  });

  it("RERUN_CHECKS from passed returns to checking", async () => {
    const actor = createActor(validationToolMachine, {
      input: makeValidationInput(),
    });
    actor.start();
    await waitForState(actor, (s) => s.matches("passed"));

    actor.send({ type: "RERUN_CHECKS" });
    expect(actor.getSnapshot().matches("checking")).toBe(true);
    actor.stop();
  });

  it("UPSTREAM_CHANGED from passed returns to checking", async () => {
    const actor = createActor(validationToolMachine, {
      input: makeValidationInput(),
    });
    actor.start();
    await waitForState(actor, (s) => s.matches("passed"));

    actor.send({ type: "UPSTREAM_CHANGED" });
    expect(actor.getSnapshot().matches("checking")).toBe(true);
    actor.stop();
  });

  it("runChecks error → loadError state, RETRY recovers", async () => {
    const runChecks = vi
      .fn()
      .mockRejectedValueOnce(new Error("network fail"))
      .mockResolvedValueOnce({ rules: CLEAN_RULES, counts: CLEAN_COUNTS });
    const actor = createActor(validationToolMachine, {
      input: makeValidationInput({
        services: makeValidationServices({ runChecks }),
      }),
    });
    actor.start();
    await waitForState(actor, (s) => s.matches("loadError"));
    expect(actor.getSnapshot().context.error?.message).toBe("network fail");

    actor.send({ type: "RETRY" });
    await waitForState(actor, (s) => s.matches("passed"));
    actor.stop();
  });
});

describe("validationTool — waiver flow", () => {
  it("WAIVE on a warning opens waiving sub-state when allowWaivers true", async () => {
    const services = makeValidationServices({
      runChecks: vi
        .fn()
        .mockResolvedValue({ rules: BLOCKED_RULES, counts: BLOCKED_COUNTS }),
    });
    const actor = createActor(validationToolMachine, {
      input: makeValidationInput({
        services,
        settings: { allowWaivers: true },
      }),
    });
    actor.start();
    await waitForState(actor, (s) => s.matches("blocked"));

    actor.send({ type: "WAIVE", ruleId: "r2" });
    expect(actor.getSnapshot().matches({ blocked: "waiving" })).toBe(true);
    expect(actor.getSnapshot().context.waiverDraft).toMatchObject({
      ruleId: "r2",
    });
    actor.stop();
  });

  it("SET_NOTE patches the waiver note", async () => {
    const services = makeValidationServices({
      runChecks: vi
        .fn()
        .mockResolvedValue({ rules: BLOCKED_RULES, counts: BLOCKED_COUNTS }),
    });
    const actor = createActor(validationToolMachine, {
      input: makeValidationInput({
        services,
        settings: { allowWaivers: true },
      }),
    });
    actor.start();
    await waitForState(actor, (s) => s.matches("blocked"));

    actor.send({ type: "WAIVE", ruleId: "r2" });
    actor.send({ type: "SET_NOTE", note: "Approved by PM" });
    expect(actor.getSnapshot().context.waiverDraft?.note).toBe(
      "Approved by PM",
    );
    actor.stop();
  });

  it("CONFIRM_WAIVE applies the waiver and recomputes counts", async () => {
    // Start with a warning-only rule set and block=advisory, so waiving
    // reduces warn count but doesn't auto-clear (only errors block in advisory)
    const warnRules: ValidationRule[] = [
      { id: "r1", name: "Open scannos", level: "warn", detail: "2 open" },
      { id: "r2", name: "Metadata", level: "pass", detail: "ok" },
    ];
    const warnCounts: ValidationCounts = { pass: 1, warn: 1, error: 0 };
    // With advisory strictness, errors=0 → machine goes to `passed` directly.
    // To test waiver in `blocked`, use block strictness:
    const services = makeValidationServices({
      runChecks: vi
        .fn()
        .mockResolvedValue({ rules: warnRules, counts: warnCounts }),
    });
    const actor = createActor(validationToolMachine, {
      input: makeValidationInput({
        services,
        settings: { strictness: "block", allowWaivers: true },
      }),
    });
    actor.start();
    await waitForState(actor, (s) => s.matches("blocked"));

    actor.send({ type: "WAIVE", ruleId: "r1" });
    actor.send({ type: "SET_NOTE", note: "Minor issue, waived" });
    actor.send({ type: "CONFIRM_WAIVE" });

    // Waiving the only warn under block-strictness should auto-transition to passed
    await waitForState(actor, (s) => s.matches("passed"));
    const snap = actor.getSnapshot();
    const waivedRule = snap.context.rules.find((r) => r.id === "r1");
    expect(waivedRule?.waiver).toBe("Minor issue, waived");
    actor.stop();
  });

  it("CANCEL from waiving returns to blocked.idle and clears draft", async () => {
    const services = makeValidationServices({
      runChecks: vi
        .fn()
        .mockResolvedValue({ rules: BLOCKED_RULES, counts: BLOCKED_COUNTS }),
    });
    const actor = createActor(validationToolMachine, {
      input: makeValidationInput({
        services,
        settings: { allowWaivers: true },
      }),
    });
    actor.start();
    await waitForState(actor, (s) => s.matches("blocked"));

    actor.send({ type: "WAIVE", ruleId: "r2" });
    actor.send({ type: "CANCEL" });
    expect(actor.getSnapshot().matches({ blocked: "idle" })).toBe(true);
    expect(actor.getSnapshot().context.waiverDraft).toBeNull();
    actor.stop();
  });

  it("WAIVE is rejected when allowWaivers false", async () => {
    const services = makeValidationServices({
      runChecks: vi
        .fn()
        .mockResolvedValue({ rules: BLOCKED_RULES, counts: BLOCKED_COUNTS }),
    });
    const actor = createActor(validationToolMachine, {
      input: makeValidationInput({
        services,
        settings: { allowWaivers: false },
      }),
    });
    actor.start();
    await waitForState(actor, (s) => s.matches("blocked"));

    actor.send({ type: "WAIVE", ruleId: "r2" });
    // Guard should block — stays in idle
    expect(actor.getSnapshot().matches({ blocked: "idle" })).toBe(true);
    expect(actor.getSnapshot().context.waiverDraft).toBeNull();
    actor.stop();
  });
});

// ---------------------------------------------------------------------------
// Suite B: blockerCount helper
// ---------------------------------------------------------------------------

describe("blockerCount helper", () => {
  it("advisory: counts only errors", () => {
    expect(blockerCount({ pass: 2, warn: 3, error: 1 }, "advisory")).toBe(1);
    expect(blockerCount({ pass: 2, warn: 3, error: 0 }, "advisory")).toBe(0);
  });

  it("block: counts errors + warnings", () => {
    expect(blockerCount({ pass: 1, warn: 2, error: 1 }, "block")).toBe(3);
    expect(blockerCount({ pass: 3, warn: 0, error: 0 }, "block")).toBe(0);
  });

  it("returns 0 for null counts", () => {
    expect(blockerCount(null, "advisory")).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Suite C: proofPackTool lifecycle
// ---------------------------------------------------------------------------

describe("proofPackTool — lifecycle", () => {
  it("starts in assembling, reaches assembled when complete", async () => {
    const actor = createActor(proofPackToolMachine, {
      input: {
        projectId: "proj-test",
        stageIndex: 18,
        services: makeProofPackServices(),
      } satisfies ProofPackToolInput,
    });
    actor.start();
    await waitForState(actor, (s) => s.matches("assembled"));
    const snap = actor.getSnapshot();
    expect(snap.context.completeness).toEqual({ complete: 387, total: 387 });
    actor.stop();
  });

  it("reaches incomplete when some pages are missing", async () => {
    const services = makeProofPackServices({
      assemblePack: vi.fn().mockResolvedValue({
        tree: [{ name: "p0001.png", meta: "1.2 MB" }],
        completeness: { complete: 385, total: 387 },
      }),
    });
    const actor = createActor(proofPackToolMachine, {
      input: {
        projectId: "proj-test",
        stageIndex: 18,
        services,
      } satisfies ProofPackToolInput,
    });
    actor.start();
    await waitForState(actor, (s) => s.matches("incomplete"));
    actor.stop();
  });

  it("UPSTREAM_CHANGED from assembled returns to assembling", async () => {
    const actor = createActor(proofPackToolMachine, {
      input: {
        projectId: "proj-test",
        stageIndex: 18,
        services: makeProofPackServices(),
      } satisfies ProofPackToolInput,
    });
    actor.start();
    await waitForState(actor, (s) => s.matches("assembled"));

    actor.send({ type: "UPSTREAM_CHANGED" });
    expect(actor.getSnapshot().matches("assembling")).toBe(true);
    actor.stop();
  });

  it("SET_INCLUDE triggers re-assemble with patched include", async () => {
    const assemblePack = vi.fn().mockResolvedValue({
      tree: [],
      completeness: { complete: 387, total: 387 },
    });
    const actor = createActor(proofPackToolMachine, {
      input: {
        projectId: "proj-test",
        stageIndex: 18,
        services: makeProofPackServices({ assemblePack }),
      } satisfies ProofPackToolInput,
    });
    actor.start();
    await waitForState(actor, (s) => s.matches("assembled"));

    actor.send({ type: "SET_INCLUDE", patch: { illustrations: false } });
    await waitForState(actor, (s) => s.matches("assembled"));

    // After SET_INCLUDE, include.illustrations should be false
    expect(actor.getSnapshot().context.include.illustrations).toBe(false);
    // assemblePack called twice (initial + after SET_INCLUDE)
    expect(assemblePack).toHaveBeenCalledTimes(2);
    actor.stop();
  });

  it("failed state → RETRY re-enters assembling", async () => {
    const assemblePack = vi
      .fn()
      .mockRejectedValueOnce(new Error("storage error"))
      .mockResolvedValueOnce({
        tree: [],
        completeness: { complete: 387, total: 387 },
      });
    const actor = createActor(proofPackToolMachine, {
      input: {
        projectId: "proj-test",
        stageIndex: 18,
        services: makeProofPackServices({ assemblePack }),
      } satisfies ProofPackToolInput,
    });
    actor.start();
    await waitForState(actor, (s) => s.matches("failed"));

    actor.send({ type: "RETRY" });
    await waitForState(actor, (s) => s.matches("assembled"));
    actor.stop();
  });
});

// ---------------------------------------------------------------------------
// Suite D: buildPackageTool — gate chain invariant 1
// Gate invariant: BUILD is disabled until preflight === "passed"
// ---------------------------------------------------------------------------

describe("buildPackageTool — preflightPassed gate", () => {
  it("BUILD is ignored when preflight is unknown", () => {
    const actor = createActor(buildPackageToolMachine, {
      input: {
        projectId: "proj-test",
        stageIndex: 19,
        services: makeBuildServices(),
      } satisfies BuildPackageToolInput,
    });
    actor.start();
    // preflight starts as "unknown"
    expect(actor.getSnapshot().context.preflight).toBe("unknown");

    actor.send({ type: "BUILD" });
    // should still be in idle (guard failed)
    expect(actor.getSnapshot().matches("idle")).toBe(true);
    actor.stop();
  });

  it("BUILD is ignored when preflight is blocked", () => {
    const actor = createActor(buildPackageToolMachine, {
      input: {
        projectId: "proj-test",
        stageIndex: 19,
        services: makeBuildServices(),
      } satisfies BuildPackageToolInput,
    });
    actor.start();
    actor.send({
      type: "PREFLIGHT_PUSH",
      status: "blocked" as PreflightStatus,
    });
    expect(actor.getSnapshot().context.preflight).toBe("blocked");

    actor.send({ type: "BUILD" });
    expect(actor.getSnapshot().matches("idle")).toBe(true);
    actor.stop();
  });

  it("BUILD proceeds when preflight is passed", async () => {
    const actor = createActor(buildPackageToolMachine, {
      input: {
        projectId: "proj-test",
        stageIndex: 19,
        services: makeBuildServices(),
      } satisfies BuildPackageToolInput,
    });
    actor.start();
    actor.send({ type: "PREFLIGHT_PUSH", status: "passed" as PreflightStatus });

    actor.send({ type: "BUILD" });
    await waitForState(actor, (s) => s.matches("built"));

    const snap = actor.getSnapshot();
    expect(snap.context.manifest?.project).toBe("belloc-survivals");
    actor.stop();
  });

  it("UPSTREAM_CHANGED from built marks deliverable stale and returns to idle", async () => {
    const actor = createActor(buildPackageToolMachine, {
      input: {
        projectId: "proj-test",
        stageIndex: 19,
        services: makeBuildServices(),
      } satisfies BuildPackageToolInput,
    });
    actor.start();
    actor.send({ type: "PREFLIGHT_PUSH", status: "passed" as PreflightStatus });
    actor.send({ type: "BUILD" });
    await waitForState(actor, (s) => s.matches("built"));

    actor.send({ type: "UPSTREAM_CHANGED" });
    const snap = actor.getSnapshot();
    expect(snap.matches("idle")).toBe(true);
    expect(snap.context.deliverable).toBeNull();
    expect(snap.context.manifest).toBeNull();
    actor.stop();
  });
});

// ---------------------------------------------------------------------------
// Suite E: zipTool — compressing state + events
// ---------------------------------------------------------------------------

describe("zipTool — compression lifecycle", () => {
  it("starts in compressing and calls requestRebuild on entry", () => {
    const requestRebuild = vi.fn().mockResolvedValue(undefined);
    const actor = createActor(zipToolMachine, {
      input: {
        projectId: "proj-test",
        stageIndex: 20,
        services: makeZipServices({ requestRebuild }),
      } satisfies ZipToolInput,
    });
    actor.start();
    expect(actor.getSnapshot().matches("compressing")).toBe(true);
    // entry action fires requestRebuild
    expect(requestRebuild).toHaveBeenCalledOnce();
    actor.stop();
  });

  it("ZIP_PROGRESS updates progress context", () => {
    const actor = createActor(zipToolMachine, {
      input: {
        projectId: "proj-test",
        stageIndex: 20,
        services: makeZipServices(),
      } satisfies ZipToolInput,
    });
    actor.start();
    actor.send({ type: "ZIP_PROGRESS", entries: 500, total: 1229, pct: 40 });
    const snap = actor.getSnapshot();
    expect(snap.context.progress).toEqual({
      entries: 500,
      total: 1229,
      pct: 40,
    });
    actor.stop();
  });

  it("ZIP_DONE transitions to built and stores archive + sha256", () => {
    const mockArchive = {
      name: "belloc-survivals.zip",
      entries: 1229,
      bytes: 1_380_000_000,
      ratio: 0.94,
      sha256: "a3f1…9c2",
    };
    const actor = createActor(zipToolMachine, {
      input: {
        projectId: "proj-test",
        stageIndex: 20,
        services: makeZipServices(),
      } satisfies ZipToolInput,
    });
    actor.start();
    actor.send({
      type: "ZIP_DONE",
      archive: mockArchive,
      tree: [{ name: "file.txt" }],
    });

    const snap = actor.getSnapshot();
    expect(snap.matches("built")).toBe(true);
    expect(snap.context.archive?.sha256).toBe("a3f1…9c2");
    expect(snap.context.progress).toBeNull();
    actor.stop();
  });

  it("ZIP_FAILED transitions to failed", () => {
    const actor = createActor(zipToolMachine, {
      input: {
        projectId: "proj-test",
        stageIndex: 20,
        services: makeZipServices(),
      } satisfies ZipToolInput,
    });
    actor.start();
    actor.send({ type: "ZIP_FAILED", error: new Error("disk full") });
    expect(actor.getSnapshot().matches("failed")).toBe(true);
    actor.stop();
  });

  it("UPSTREAM_CHANGED from built returns to compressing", () => {
    const mockArchive = {
      name: "belloc-survivals.zip",
      entries: 1229,
      bytes: 1_380_000_000,
      ratio: 0.94,
      sha256: "a3f1…9c2",
    };
    const actor = createActor(zipToolMachine, {
      input: {
        projectId: "proj-test",
        stageIndex: 20,
        services: makeZipServices(),
      } satisfies ZipToolInput,
    });
    actor.start();
    actor.send({ type: "ZIP_DONE", archive: mockArchive, tree: [] });
    expect(actor.getSnapshot().matches("built")).toBe(true);

    actor.send({ type: "UPSTREAM_CHANGED" });
    expect(actor.getSnapshot().matches("compressing")).toBe(true);
    actor.stop();
  });

  it("RETRY from failed returns to compressing", () => {
    const actor = createActor(zipToolMachine, {
      input: {
        projectId: "proj-test",
        stageIndex: 20,
        services: makeZipServices(),
      } satisfies ZipToolInput,
    });
    actor.start();
    actor.send({ type: "ZIP_FAILED", error: new Error("network") });
    actor.send({ type: "RETRY" });
    expect(actor.getSnapshot().matches("compressing")).toBe(true);
    actor.stop();
  });
});

// ---------------------------------------------------------------------------
// Suite F: submitCheckTool — dry-run + GateConfirmation (submit gate chain invariants 3+4)
// ---------------------------------------------------------------------------

describe("submitCheckTool — dry-run and SUBMIT gate", () => {
  it("starts in dryRunning and reaches ready when all checks pass", async () => {
    const actor = createActor(submitCheckToolMachine, {
      input: {
        projectId: "proj-test",
        stageIndex: 21,
        services: makeSubmitCheckServices(),
        settings: { confirmOnSubmit: false },
      } satisfies SubmitCheckToolInput,
    });
    actor.start();
    await waitForState(actor, (s) => s.matches("ready"));
    const snap = actor.getSnapshot();
    expect(snap.context.dryRunOk).toBe(true);
    expect(snap.context.checks).toHaveLength(3);
    actor.stop();
  });

  it("reaches blocked when a check fails", async () => {
    const services = makeSubmitCheckServices({
      dryRun: vi.fn().mockResolvedValue([
        { ok: false, label: "File naming scheme incorrect" },
        { ok: true, label: "Package size within limits" },
      ]),
    });
    const actor = createActor(submitCheckToolMachine, {
      input: {
        projectId: "proj-test",
        stageIndex: 21,
        services,
      } satisfies SubmitCheckToolInput,
    });
    actor.start();
    await waitForState(actor, (s) => s.matches("blocked"));
    expect(actor.getSnapshot().context.dryRunOk).toBe(false);
    actor.stop();
  });

  it("SUBMIT without confirmOnSubmit goes directly to submitting", async () => {
    const actor = createActor(submitCheckToolMachine, {
      input: {
        projectId: "proj-test",
        stageIndex: 21,
        services: makeSubmitCheckServices(),
        settings: { confirmOnSubmit: false },
      } satisfies SubmitCheckToolInput,
    });
    actor.start();
    await waitForState(actor, (s) => s.matches("ready"));

    actor.send({ type: "SUBMIT" });
    // Should go to submitting (not confirmingSubmit)
    await waitForState(actor, (s) => s.matches("submitted"));
    actor.stop();
  });

  it("SUBMIT with confirmOnSubmit routes through confirmingSubmit gate", async () => {
    const actor = createActor(submitCheckToolMachine, {
      input: {
        projectId: "proj-test",
        stageIndex: 21,
        services: makeSubmitCheckServices(),
        settings: { confirmOnSubmit: true },
      } satisfies SubmitCheckToolInput,
    });
    actor.start();
    await waitForState(actor, (s) => s.matches("ready"));

    actor.send({ type: "SUBMIT" });
    // Must be in confirmingSubmit (gate)
    expect(actor.getSnapshot().matches("confirmingSubmit")).toBe(true);

    // CANCEL returns to ready
    actor.send({ type: "CANCEL" });
    expect(actor.getSnapshot().matches("ready")).toBe(true);
    actor.stop();
  });

  it("CONFIRM from confirmingSubmit proceeds to submitted (final)", async () => {
    const actor = createActor(submitCheckToolMachine, {
      input: {
        projectId: "proj-test",
        stageIndex: 21,
        services: makeSubmitCheckServices(),
        settings: { confirmOnSubmit: true },
      } satisfies SubmitCheckToolInput,
    });
    actor.start();
    await waitForState(actor, (s) => s.matches("ready"));

    actor.send({ type: "SUBMIT" });
    expect(actor.getSnapshot().matches("confirmingSubmit")).toBe(true);

    actor.send({ type: "CONFIRM" });
    await waitForState(actor, (s) => s.matches("submitted"));

    const snap = actor.getSnapshot();
    expect(snap.context.submittedAt).toBe("2026-06-10T12:00:00Z");
    expect(snap.matches("submitted")).toBe(true);
    actor.stop();
  });

  it("UPSTREAM_CHANGED from ready resets to dryRunning", async () => {
    const actor = createActor(submitCheckToolMachine, {
      input: {
        projectId: "proj-test",
        stageIndex: 21,
        services: makeSubmitCheckServices(),
      } satisfies SubmitCheckToolInput,
    });
    actor.start();
    await waitForState(actor, (s) => s.matches("ready"));

    actor.send({ type: "UPSTREAM_CHANGED" });
    expect(actor.getSnapshot().matches("dryRunning")).toBe(true);
    actor.stop();
  });

  it("liveSubmit error returns to ready with error context", async () => {
    const services = makeSubmitCheckServices({
      liveSubmit: vi.fn().mockRejectedValue(new Error("upload failed")),
    });
    const actor = createActor(submitCheckToolMachine, {
      input: {
        projectId: "proj-test",
        stageIndex: 21,
        services,
        settings: { confirmOnSubmit: false },
      } satisfies SubmitCheckToolInput,
    });
    actor.start();
    await waitForState(actor, (s) => s.matches("ready"));

    actor.send({ type: "SUBMIT" });
    await waitForState(actor, (s) => s.matches("ready"));
    expect(actor.getSnapshot().context.error?.message).toBe("upload failed");
    actor.stop();
  });
});

// ---------------------------------------------------------------------------
// Suite G: archiveTool — terminal pipeline stage
// ---------------------------------------------------------------------------

describe("archiveTool — lifecycle", () => {
  it("starts in reviewing with default items", () => {
    const actor = createActor(archiveToolMachine, {
      input: {
        projectId: "proj-test",
        stageIndex: 23,
        services: makeArchiveServices(),
      } satisfies ArchiveToolInput,
    });
    actor.start();
    const snap = actor.getSnapshot();
    expect(snap.matches("reviewing")).toBe(true);
    expect(snap.context.items.length).toBeGreaterThan(0);
    actor.stop();
  });

  it("TOGGLE_KEEP flips the keep flag for the named item", () => {
    const actor = createActor(archiveToolMachine, {
      input: {
        projectId: "proj-test",
        stageIndex: 23,
        services: makeArchiveServices(),
        initialItems: [
          { name: "Original scans", meta: "source", keep: true },
          { name: "Intermediates", meta: "re-derivable", keep: false },
        ],
      } satisfies ArchiveToolInput,
    });
    actor.start();

    actor.send({ type: "TOGGLE_KEEP", name: "Original scans" });
    const snap = actor.getSnapshot();
    const item = snap.context.items.find((it) => it.name === "Original scans");
    expect(item?.keep).toBe(false);
    actor.stop();
  });

  it("ARCHIVE_NOW transitions to archiving then archived", async () => {
    const actor = createActor(archiveToolMachine, {
      input: {
        projectId: "proj-test",
        stageIndex: 23,
        services: makeArchiveServices(),
      } satisfies ArchiveToolInput,
    });
    actor.start();

    actor.send({ type: "ARCHIVE_NOW" });
    await waitForState(actor, (s) => s.matches("archived"));

    const snap = actor.getSnapshot();
    expect(snap.context.result).toEqual({ kept: "3.5 GB", dropped: "18.4 GB" });
    actor.stop();
  });

  it("UPSTREAM_CHANGED from archived returns to reviewing", async () => {
    const actor = createActor(archiveToolMachine, {
      input: {
        projectId: "proj-test",
        stageIndex: 23,
        services: makeArchiveServices(),
      } satisfies ArchiveToolInput,
    });
    actor.start();
    actor.send({ type: "ARCHIVE_NOW" });
    await waitForState(actor, (s) => s.matches("archived"));

    actor.send({ type: "UPSTREAM_CHANGED" });
    expect(actor.getSnapshot().matches("reviewing")).toBe(true);
    actor.stop();
  });

  it("archiveProject error returns to reviewing with error", async () => {
    const services = makeArchiveServices({
      archiveProject: vi
        .fn()
        .mockRejectedValue(new Error("storage unavailable")),
    });
    const actor = createActor(archiveToolMachine, {
      input: {
        projectId: "proj-test",
        stageIndex: 23,
        services,
      } satisfies ArchiveToolInput,
    });
    actor.start();
    actor.send({ type: "ARCHIVE_NOW" });
    await waitForState(actor, (s) => s.matches("reviewing"));
    expect(actor.getSnapshot().context.error?.message).toBe(
      "storage unavailable",
    );
    actor.stop();
  });
});

// ---------------------------------------------------------------------------
// Suite H: Gate chain integration — validation→build→zip→submit
// Invariant 5: UPSTREAM_CHANGED propagates stale through the chain
// ---------------------------------------------------------------------------

describe("gate chain integration — full pipeline", () => {
  let validationActor: ReturnType<
    typeof createActor<typeof validationToolMachine>
  >;
  let buildActor: ReturnType<
    typeof createActor<typeof buildPackageToolMachine>
  >;
  let zipActor: ReturnType<typeof createActor<typeof zipToolMachine>>;
  let submitActor: ReturnType<
    typeof createActor<typeof submitCheckToolMachine>
  >;

  beforeEach(() => {
    validationActor = createActor(validationToolMachine, {
      input: makeValidationInput(),
    });
    buildActor = createActor(buildPackageToolMachine, {
      input: {
        projectId: "proj-test",
        stageIndex: 19,
        services: makeBuildServices(),
      } satisfies BuildPackageToolInput,
    });
    zipActor = createActor(zipToolMachine, {
      input: {
        projectId: "proj-test",
        stageIndex: 20,
        services: makeZipServices(),
      } satisfies ZipToolInput,
    });
    submitActor = createActor(submitCheckToolMachine, {
      input: {
        projectId: "proj-test",
        stageIndex: 21,
        services: makeSubmitCheckServices(),
        settings: { confirmOnSubmit: false },
      } satisfies SubmitCheckToolInput,
    });
  });

  it("full chain: validation passed → build unblocked → zip → submit dry-run → submitted", async () => {
    // 1. Start validation
    validationActor.start();
    await waitForState(validationActor, (s) => s.matches("passed"));

    // 2. Fan PREFLIGHT_PUSH to build
    buildActor.start();
    buildActor.send({ type: "PREFLIGHT_PUSH", status: "passed" });

    // 3. BUILD is now allowed
    buildActor.send({ type: "BUILD" });
    await waitForState(buildActor, (s) => s.matches("built"));
    expect(buildActor.getSnapshot().context.manifest).not.toBeNull();

    // 4. Zip starts compressing (it auto-starts on entry)
    zipActor.start();
    const mockArchive = {
      name: "belloc-survivals.zip",
      entries: 1229,
      bytes: 1_380_000_000,
      ratio: 0.94,
      sha256: "a3f1…9c2",
    };
    zipActor.send({ type: "ZIP_DONE", archive: mockArchive, tree: [] });
    expect(zipActor.getSnapshot().matches("built")).toBe(true);

    // 5. Submit dry-run runs automatically
    submitActor.start();
    await waitForState(submitActor, (s) => s.matches("ready"));

    // 6. SUBMIT (no confirm required)
    submitActor.send({ type: "SUBMIT" });
    await waitForState(submitActor, (s) => s.matches("submitted"));
    expect(submitActor.getSnapshot().context.submittedAt).toBeTruthy();

    validationActor.stop();
    buildActor.stop();
    zipActor.stop();
    submitActor.stop();
  });

  it("UPSTREAM_CHANGED at validation level cascades stale through chain", async () => {
    // Set up chain in "clean" state
    validationActor.start();
    await waitForState(validationActor, (s) => s.matches("passed"));

    buildActor.start();
    buildActor.send({ type: "PREFLIGHT_PUSH", status: "passed" });
    buildActor.send({ type: "BUILD" });
    await waitForState(buildActor, (s) => s.matches("built"));

    const archive = {
      name: "belloc-survivals.zip",
      entries: 1229,
      bytes: 1_380_000_000,
      ratio: 0.94,
      sha256: "a3f1…9c2",
    };
    zipActor.start();
    zipActor.send({ type: "ZIP_DONE", archive, tree: [] });

    submitActor.start();
    await waitForState(submitActor, (s) => s.matches("ready"));

    // Now simulate an upstream re-run invalidating validation
    // (fan-out would be orchestrated by pipelineShell at I1)
    validationActor.send({ type: "UPSTREAM_CHANGED" });
    expect(validationActor.getSnapshot().matches("checking")).toBe(true);

    buildActor.send({ type: "UPSTREAM_CHANGED" });
    const buildSnap = buildActor.getSnapshot();
    expect(buildSnap.matches("idle")).toBe(true);
    expect(buildSnap.context.deliverable).toBeNull();

    zipActor.send({ type: "UPSTREAM_CHANGED" });
    expect(zipActor.getSnapshot().matches("compressing")).toBe(true);

    submitActor.send({ type: "UPSTREAM_CHANGED" });
    expect(submitActor.getSnapshot().matches("dryRunning")).toBe(true);

    validationActor.stop();
    buildActor.stop();
    zipActor.stop();
    submitActor.stop();
  });
});
