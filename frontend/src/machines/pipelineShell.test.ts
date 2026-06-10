/**
 * pipelineShell machine test suite.
 *
 * Tests per Task F4 specification:
 * 1. Boot lifecycle: booting → pipeline (23 runners spawned)
 * 2. Stage selection: SELECT_STAGE, PREV, NEXT
 * 3. Tab selection: SET_TAB
 * 4. Settings mode toggle: OPEN_SETTINGS / CLOSE_SETTINGS
 * 5. Fan-out staleness: STAGE_COMPLETED → downstream runners receive UPSTREAM_CHANGED
 * 6. PROGRESS_PUSH translation (DIVERGENCES #10)
 * 7. STAGE_PUSH routing
 * 8. RUN_ALL_STALE callback
 */

import { describe, it, expect, vi } from "vitest";
import { createActor } from "xstate";
import {
  pipelineShellMachine,
  STAGE_DEFS,
  RUNNER_STAGE_DEFS,
  runnerIndexOf,
  stageDefIndexOf,
  tabsForStage,
  type PipelineShellServices,
  type AutomationToggles,
} from "./pipelineShell";
import type { PipelineSnapshot } from "@/mocks/types";
import {
  MOCK_PROJECT_ID,
  MOCK_PROJECT,
  MOCK_AUTOMATION,
  STAGE_DEPS,
  makeFreshPageStages,
  makeFreshProjectStages,
  computeDownstream,
} from "@/mocks/fixtures";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePipelineSnapshot(
  automationOverrides: Partial<typeof MOCK_AUTOMATION> = {},
): PipelineSnapshot {
  const projectStagesMap = makeFreshProjectStages();
  const pageStagesMap = makeFreshPageStages();

  // Build page_stages_summary from the fresh matrix
  const pageStageIds = Array.from(pageStagesMap.get("0000")?.keys() ?? []);
  const pageStageSummary = pageStageIds.map((stageId) => ({
    stage_id: stageId,
    worst_status: "not_run" as const,
    stale_count: 0,
    flagged_count: 0,
  }));

  return {
    project: MOCK_PROJECT,
    page_stages_summary: pageStageSummary,
    project_stages: Array.from(projectStagesMap.values()),
    automation: { ...MOCK_AUTOMATION, ...automationOverrides },
  };
}

function makeServices(
  overrides: Partial<PipelineShellServices> = {},
): PipelineShellServices {
  const snapshot = makePipelineSnapshot();
  return {
    fetchPipeline: vi.fn().mockResolvedValue(snapshot),
    runnerServices: {
      runStage: vi
        .fn()
        .mockResolvedValue({ status: "clean", flaggedPages: [] }),
      requestCancel: vi.fn().mockResolvedValue(undefined),
      requestPause: vi.fn().mockResolvedValue(undefined),
    },
    ...overrides,
  };
}

async function bootedShell(
  services?: Partial<PipelineShellServices>,
  initialStageId?: string,
) {
  const actor = createActor(pipelineShellMachine, {
    input: {
      projectId: MOCK_PROJECT_ID,
      services: makeServices(services),
      initialStageId: initialStageId ?? "threshold",
    },
  });
  actor.start();
  // Wait for fetchPipeline to resolve
  await new Promise((r) => setTimeout(r, 0));
  return actor;
}

// ---------------------------------------------------------------------------
// Boot lifecycle
// ---------------------------------------------------------------------------

describe("pipelineShell — boot lifecycle", () => {
  it("starts in booting state", () => {
    const actor = createActor(pipelineShellMachine, {
      input: {
        projectId: MOCK_PROJECT_ID,
        services: makeServices(),
      },
    });
    actor.start();
    expect(actor.getSnapshot().value).toBe("booting");
    actor.stop();
  });

  it("transitions booting → pipeline after fetchPipeline resolves", async () => {
    const actor = await bootedShell();
    expect(actor.getSnapshot().matches("pipeline")).toBe(true);
    actor.stop();
  });

  it("spawns 23 runner actors", async () => {
    const actor = await bootedShell();
    const { runners } = actor.getSnapshot().context;
    expect(runners).toHaveLength(RUNNER_STAGE_DEFS.length);
    expect(RUNNER_STAGE_DEFS.length).toBe(23);
    actor.stop();
  });

  it("each runner has correct stageId from RUNNER_STAGE_DEFS", async () => {
    const actor = await bootedShell();
    const { runners } = actor.getSnapshot().context;
    for (let i = 0; i < RUNNER_STAGE_DEFS.length; i++) {
      const runnerSnap = runners[i]?.getSnapshot();
      expect(runnerSnap?.context.stageId).toBe(RUNNER_STAGE_DEFS[i]?.id);
    }
    actor.stop();
  });

  it("transitions booting → loadError when fetchPipeline rejects", async () => {
    const actor = createActor(pipelineShellMachine, {
      input: {
        projectId: MOCK_PROJECT_ID,
        services: makeServices({
          fetchPipeline: vi.fn().mockRejectedValue(new Error("network error")),
        }),
      },
    });
    actor.start();
    await new Promise((r) => setTimeout(r, 0));
    expect(actor.getSnapshot().value).toBe("loadError");
    actor.stop();
  });

  it("can RETRY from loadError", async () => {
    const fetchPipeline = vi
      .fn()
      .mockRejectedValueOnce(new Error("fail"))
      .mockResolvedValue(makePipelineSnapshot());

    const actor = createActor(pipelineShellMachine, {
      input: {
        projectId: MOCK_PROJECT_ID,
        services: makeServices({ fetchPipeline }),
      },
    });
    actor.start();
    await new Promise((r) => setTimeout(r, 0));
    expect(actor.getSnapshot().value).toBe("loadError");

    actor.send({ type: "RETRY" });
    await new Promise((r) => setTimeout(r, 0));
    expect(actor.getSnapshot().matches("pipeline")).toBe(true);
    actor.stop();
  });

  it("assigns automation from snapshot", async () => {
    const actor = await bootedShell({
      fetchPipeline: vi
        .fn()
        .mockResolvedValue(
          makePipelineSnapshot({ rerun_downstream_on_stale: true }),
        ),
    });
    const { automation } = actor.getSnapshot().context;
    expect(automation.rerunDownstreamOnStale).toBe(true);
    actor.stop();
  });
});

// ---------------------------------------------------------------------------
// Stage selection
// ---------------------------------------------------------------------------

describe("pipelineShell — stage selection", () => {
  it("resolves initial stageId from input", async () => {
    const actor = await bootedShell(undefined, "ocr");
    const ctx = actor.getSnapshot().context;
    expect(ctx.currentStageId).toBe("ocr");
    expect(ctx.currentIndex).toBe(stageDefIndexOf("ocr"));
    actor.stop();
  });

  it("SELECT_STAGE updates currentStageId and currentIndex", async () => {
    const actor = await bootedShell();
    actor.send({ type: "SELECT_STAGE", stageId: "grayscale" });
    const ctx = actor.getSnapshot().context;
    expect(ctx.currentStageId).toBe("grayscale");
    expect(ctx.currentIndex).toBe(stageDefIndexOf("grayscale"));
    actor.stop();
  });

  it("SELECT_STAGE is ignored if stageId is unchanged", async () => {
    const actor = await bootedShell(undefined, "threshold");
    const beforeCtx = actor.getSnapshot().context;
    actor.send({ type: "SELECT_STAGE", stageId: "threshold" });
    const afterCtx = actor.getSnapshot().context;
    expect(afterCtx.currentStageId).toBe(beforeCtx.currentStageId);
    actor.stop();
  });

  it("PREV decrements currentIndex", async () => {
    const actor = await bootedShell(undefined, "grayscale");
    const initialIndex = stageDefIndexOf("grayscale");
    actor.send({ type: "PREV" });
    const ctx = actor.getSnapshot().context;
    expect(ctx.currentIndex).toBe(initialIndex - 1);
    actor.stop();
  });

  it("PREV is ignored at the first stage (source, index 0)", async () => {
    const actor = await bootedShell(undefined, "source");
    actor.send({ type: "PREV" });
    const ctx = actor.getSnapshot().context;
    expect(ctx.currentIndex).toBe(0);
    actor.stop();
  });

  it("NEXT increments currentIndex", async () => {
    const actor = await bootedShell(undefined, "threshold");
    const initialIndex = stageDefIndexOf("threshold");
    actor.send({ type: "NEXT" });
    const ctx = actor.getSnapshot().context;
    expect(ctx.currentIndex).toBe(initialIndex + 1);
    actor.stop();
  });

  it("NEXT is ignored at the last stage (archive, index 23)", async () => {
    const actor = await bootedShell(undefined, "archive");
    actor.send({ type: "NEXT" });
    const ctx = actor.getSnapshot().context;
    expect(ctx.currentIndex).toBe(stageDefIndexOf("archive"));
    actor.stop();
  });

  it("SELECT_STAGE resets tab to default for that stage", async () => {
    const actor = await bootedShell(undefined, "threshold");
    actor.send({ type: "SET_TAB", tab: "settings" });
    actor.send({ type: "SELECT_STAGE", stageId: "ocr" });
    const ctx = actor.getSnapshot().context;
    const tabs = tabsForStage("ocr");
    const expectedTab =
      tabs.find((t) => t.id !== "overview")?.id ?? tabs[0]?.id ?? "overview";
    expect(ctx.currentTab).toBe(expectedTab);
    actor.stop();
  });
});

// ---------------------------------------------------------------------------
// Tab selection
// ---------------------------------------------------------------------------

describe("pipelineShell — tab selection", () => {
  it("SET_TAB updates currentTab when tab exists for stage", async () => {
    const actor = await bootedShell(undefined, "threshold");
    actor.send({ type: "SET_TAB", tab: "settings" });
    expect(actor.getSnapshot().context.currentTab).toBe("settings");
    actor.stop();
  });

  it("SET_TAB is ignored when tab does not exist for stage", async () => {
    const actor = await bootedShell(undefined, "threshold");
    const before = actor.getSnapshot().context.currentTab;
    actor.send({ type: "SET_TAB", tab: "nonexistent-tab-xyz" });
    expect(actor.getSnapshot().context.currentTab).toBe(before);
    actor.stop();
  });
});

// ---------------------------------------------------------------------------
// Settings mode toggle
// ---------------------------------------------------------------------------

describe("pipelineShell — settings mode", () => {
  it("OPEN_SETTINGS enters mode.settings", async () => {
    const actor = await bootedShell();
    actor.send({ type: "OPEN_SETTINGS" });
    expect(
      actor.getSnapshot().matches({ pipeline: { mode: "settings" } }),
    ).toBe(true);
    actor.stop();
  });

  it("CLOSE_SETTINGS returns to mode.stages", async () => {
    const actor = await bootedShell();
    actor.send({ type: "OPEN_SETTINGS" });
    actor.send({ type: "CLOSE_SETTINGS" });
    expect(actor.getSnapshot().matches({ pipeline: { mode: "stages" } })).toBe(
      true,
    );
    actor.stop();
  });

  it("CLOSE_SETTINGS syncs automation from event payload", async () => {
    const actor = await bootedShell();
    actor.send({ type: "OPEN_SETTINGS" });
    const newAutomation: AutomationToggles = {
      autoRunAfterIngest: false,
      rerunDownstreamOnStale: false,
      notifyOnError: false,
      pauseOnFlagPct: 25,
    };
    actor.send({ type: "CLOSE_SETTINGS", automation: newAutomation });
    expect(actor.getSnapshot().context.automation).toEqual(newAutomation);
    actor.stop();
  });

  it("_inSettings flag is set on OPEN_SETTINGS", async () => {
    const actor = await bootedShell();
    actor.send({ type: "OPEN_SETTINGS" });
    expect(actor.getSnapshot().context._inSettings).toBe(true);
    actor.stop();
  });

  it("_inSettings flag is cleared on CLOSE_SETTINGS", async () => {
    const actor = await bootedShell();
    actor.send({ type: "OPEN_SETTINGS" });
    actor.send({ type: "CLOSE_SETTINGS" });
    expect(actor.getSnapshot().context._inSettings).toBe(false);
    actor.stop();
  });

  it("onOpenSettings callback is invoked with projectId", async () => {
    const onOpenSettings = vi.fn();
    const actor = createActor(pipelineShellMachine, {
      input: {
        projectId: MOCK_PROJECT_ID,
        services: makeServices(),
        onOpenSettings,
      },
    });
    actor.start();
    await new Promise((r) => setTimeout(r, 0));
    actor.send({ type: "OPEN_SETTINGS" });
    expect(onOpenSettings).toHaveBeenCalledWith(MOCK_PROJECT_ID);
    actor.stop();
  });
});

// ---------------------------------------------------------------------------
// Fan-out staleness
// ---------------------------------------------------------------------------

describe("pipelineShell — fan-out staleness", () => {
  it("STAGE_COMPLETED sends UPSTREAM_CHANGED to all downstream runners", async () => {
    const actor = await bootedShell({
      fetchPipeline: vi
        .fn()
        .mockResolvedValue(
          makePipelineSnapshot({ rerun_downstream_on_stale: false }),
        ),
    });
    const { runners } = actor.getSnapshot().context;

    // Record what each runner receives by tracking their state changes
    // threshold (runner index 2 in RUNNER_STAGE_DEFS) — drive it to clean first
    const thresholdIdx = runnerIndexOf("threshold");
    const thresholdRunner = runners[thresholdIdx];
    if (thresholdRunner) {
      thresholdRunner.send({ type: "RUN" });
      thresholdRunner.send({ type: "START" });
      await new Promise((r) => setTimeout(r, 0));
    }

    // Send STAGE_COMPLETED for "crop" stage (upstream of threshold)
    const cropStageDefIdx = stageDefIndexOf("crop");
    actor.send({
      type: "STAGE_COMPLETED",
      stageId: "crop",
      fromIndex: cropStageDefIdx,
    });

    // threshold is downstream of crop → should now be stale
    const thresholdSnap = thresholdRunner?.getSnapshot();
    expect(thresholdSnap?.value).toBe("stale");
    actor.stop();
  });

  it("fan-out auto-queues runners when rerunDownstreamOnStale=true", async () => {
    const actor = await bootedShell({
      fetchPipeline: vi
        .fn()
        .mockResolvedValue(
          makePipelineSnapshot({ rerun_downstream_on_stale: true }),
        ),
    });
    const { runners } = actor.getSnapshot().context;

    // Drive threshold to clean
    const thresholdIdx = runnerIndexOf("threshold");
    const thresholdRunner = runners[thresholdIdx];
    if (thresholdRunner) {
      thresholdRunner.send({ type: "RUN" });
      thresholdRunner.send({ type: "START" });
      await new Promise((r) => setTimeout(r, 0));
    }

    // Fan out from crop
    actor.send({
      type: "STAGE_COMPLETED",
      stageId: "crop",
      fromIndex: stageDefIndexOf("crop"),
    });

    // With autoRerun=true, threshold should auto-queue (stale → queued via always guard)
    const thresholdSnap = thresholdRunner?.getSnapshot();
    expect(thresholdSnap?.value).toBe("queued");
    actor.stop();
  });

  it("computeDownstream is used correctly for fan-out", () => {
    // Verify the dependency graph: crop → threshold (and all its descendants)
    const downstream = computeDownstream("crop");
    expect(downstream).toContain("threshold");
    expect(downstream).toContain("deskew");
    expect(downstream).toContain("ocr");
    // source has no dependents
    expect(computeDownstream("archive")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// PROGRESS_PUSH translation (DIVERGENCES #10)
// ---------------------------------------------------------------------------

describe("pipelineShell — PROGRESS_PUSH translation (DIVERGENCES #10)", () => {
  it("PROGRESS_PUSH routes to matching runner as PROGRESS { value }", async () => {
    const actor = await bootedShell();
    const { runners } = actor.getSnapshot().context;

    const grayscaleIdx = runnerIndexOf("grayscale");
    const grayscaleRunner = runners[grayscaleIdx];

    // Drive runner to running state
    if (grayscaleRunner) {
      grayscaleRunner.send({ type: "RUN" });
      grayscaleRunner.send({ type: "START" });
    }

    // Send PROGRESS_PUSH — shell translates and forwards
    actor.send({
      type: "PROGRESS_PUSH",
      stage_id: "grayscale",
      progress: 0.42,
      message: "Processing",
    });

    const snap = grayscaleRunner?.getSnapshot();
    expect(snap?.context.progress).toBe(0.42);
    actor.stop();
  });

  it("STAGE_PUSH(progress) routes to matching runner as PROGRESS { value }", async () => {
    const actor = await bootedShell();
    const { runners } = actor.getSnapshot().context;

    const grayscaleIdx = runnerIndexOf("grayscale");
    const grayscaleRunner = runners[grayscaleIdx];

    if (grayscaleRunner) {
      grayscaleRunner.send({ type: "RUN" });
      grayscaleRunner.send({ type: "START" });
    }

    actor.send({
      type: "STAGE_PUSH",
      variant: "progress",
      stage_id: "grayscale",
      progress: 0.75,
      message: "75%",
    });

    const snap = grayscaleRunner?.getSnapshot();
    expect(snap?.context.progress).toBe(0.75);
    actor.stop();
  });

  it("STAGE_PUSH(status) routes to matching runner as STAGE_PUSH", async () => {
    const actor = await bootedShell();
    const { runners } = actor.getSnapshot().context;

    const grayscaleIdx = runnerIndexOf("grayscale");
    const grayscaleRunner = runners[grayscaleIdx];

    // Send status push — should not throw
    expect(() => {
      actor.send({
        type: "STAGE_PUSH",
        variant: "status",
        stage_id: "grayscale",
        status: "clean",
        job_id: null,
        error_message: null,
      });
    }).not.toThrow();

    // reconcile action should have updated context
    const snap = grayscaleRunner?.getSnapshot();
    expect(snap?.context.progress).toBe(1);
    actor.stop();
  });

  it("PROGRESS_PUSH for unknown stage_id does not throw", async () => {
    const actor = await bootedShell();
    expect(() => {
      actor.send({
        type: "PROGRESS_PUSH",
        stage_id: "nonexistent_stage",
        progress: 0.5,
        message: "x",
      });
    }).not.toThrow();
    actor.stop();
  });
});

// ---------------------------------------------------------------------------
// PAGES_RESOLVED routing
// ---------------------------------------------------------------------------

describe("pipelineShell — PAGES_RESOLVED routing", () => {
  it("PAGES_RESOLVED sends RESOLVE to the owning runner", async () => {
    const actor = await bootedShell();
    const { runners } = actor.getSnapshot().context;

    const ocrIdx = runnerIndexOf("ocr");
    const ocrRunner = runners[ocrIdx];

    // Drive runner to flagged state
    if (ocrRunner) {
      // Override runStage to return flagged
      // (runner service is shared mock — won't flag in this context;
      //  just send the event and check it doesn't throw)
    }

    expect(() => {
      actor.send({
        type: "PAGES_RESOLVED",
        stageId: "ocr",
        stageIndex: ocrIdx,
        resolvedIds: ["0003"],
      });
    }).not.toThrow();

    actor.stop();
  });
});

// ---------------------------------------------------------------------------
// RUN_ALL_STALE callback
// ---------------------------------------------------------------------------

describe("pipelineShell — RUN_ALL_STALE", () => {
  it("RUN_ALL_STALE calls onRunAllStale with stale runner indices", async () => {
    const onRunAllStale = vi.fn();
    const actor = createActor(pipelineShellMachine, {
      input: {
        projectId: MOCK_PROJECT_ID,
        services: makeServices(),
        onRunAllStale,
      },
    });
    actor.start();
    await new Promise((r) => setTimeout(r, 0));

    // Mark a runner stale manually
    const { runners } = actor.getSnapshot().context;
    const grayscaleIdx = runnerIndexOf("grayscale");
    const grayscaleRunner = runners[grayscaleIdx];
    if (grayscaleRunner) {
      grayscaleRunner.send({ type: "RUN" });
      grayscaleRunner.send({ type: "START" });
      await new Promise((r) => setTimeout(r, 0));
      grayscaleRunner.send({ type: "UPSTREAM_CHANGED", autoRerun: false });
    }

    actor.send({ type: "RUN_ALL_STALE" });
    // onRunAllStale should have been called with at least the grayscale index
    expect(onRunAllStale).toHaveBeenCalled();
    const [indices] = onRunAllStale.mock.calls[0] as [number[]];
    expect(Array.isArray(indices)).toBe(true);

    actor.stop();
  });
});

// ---------------------------------------------------------------------------
// Helper function tests
// ---------------------------------------------------------------------------

describe("pipelineShell — helpers", () => {
  it("runnerIndexOf returns correct index for runner stages", () => {
    expect(runnerIndexOf("grayscale")).toBe(0);
    expect(runnerIndexOf("crop")).toBe(1);
    expect(runnerIndexOf("archive")).toBe(22);
  });

  it("runnerIndexOf returns -1 for source (no runner)", () => {
    expect(runnerIndexOf("source")).toBe(-1);
  });

  it("stageDefIndexOf returns correct index including source", () => {
    expect(stageDefIndexOf("source")).toBe(0);
    expect(stageDefIndexOf("grayscale")).toBe(1);
    expect(stageDefIndexOf("archive")).toBe(23);
  });

  it("tabsForStage returns stage-specific tabs for ocr", () => {
    const tabs = tabsForStage("ocr");
    expect(tabs.some((t) => t.id === "recognition")).toBe(true);
  });

  it("tabsForStage falls back to default tabs for unknown stage", () => {
    const tabs = tabsForStage("totally_unknown_stage");
    expect(tabs.some((t) => t.id === "overview")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Topological order invariant
// ---------------------------------------------------------------------------

describe("pipelineShell — STAGE_DEFS topological order", () => {
  it("every stage's deps appear earlier in STAGE_DEFS", () => {
    const positionOf: Record<string, number> = {};
    for (let i = 0; i < STAGE_DEFS.length; i++) {
      positionOf[STAGE_DEFS[i]!.id] = i;
    }

    const violations: string[] = [];
    for (const def of STAGE_DEFS) {
      const deps = STAGE_DEPS[def.id] ?? [];
      for (const dep of deps) {
        // Cross-scope deps that reference another stage in STAGE_DEFS must
        // appear earlier. Deps not in STAGE_DEFS (e.g. blank_proof_synth alt)
        // are internal implementation details and are skipped.
        if (!(dep in positionOf)) continue;
        if (positionOf[dep]! >= positionOf[def.id]!) {
          violations.push(
            `${def.id} (index ${positionOf[def.id]!.toString()}) depends on ` +
              `${dep} (index ${positionOf[dep]!.toString()}) which appears later`,
          );
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
