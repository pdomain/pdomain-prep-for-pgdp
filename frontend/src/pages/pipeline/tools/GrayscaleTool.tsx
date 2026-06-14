/**
 * GrayscaleTool — high-fidelity React surface for the Grayscale stage (stage 02).
 *
 * Four tabs that match the design canvas:
 *   - Overview       — stat tiles + auto-detect banner + downstream impact cards
 *   - Pages          — filterable page grid (all / perceptual / standard)
 *   - Page workbench — two-pane: stage controls drawer (340px) + page viewer
 *                      (before/after split + page strip)
 *   - Stage settings — full-width mode cards + advanced params + auto-detect banner
 *
 * The workbench tab wires the real grayscale artifact endpoint:
 *   GET /api/data/projects/{id}/pages/{idx0}/stages/grayscale/artifact
 *
 * Design references:
 *   - docs/plans/design_handoff_pgdp_app/final/grayscale/grayscale.jsx
 *   - .audit-shots/D07-grayscale.png
 *   - docs/plans/design_handoff_pgdp_app/design-system/tokens.css
 *
 * Machine: grayscaleToolMachine (src/machines/tools/grayscaleTool.ts)
 * Services: buildRealGrayscaleToolServices (src/services/tools/grayscaleTool.ts)
 *
 * I1 wiring complete:
 *   - Apply & Run → POST .../project-stages/grayscale/run (requestRun action)
 *   - Re-run page → POST .../pages/{idx0}/stages/grayscale/run (requestPageRun action)
 *   - Save as default → saveAsDefault service
 *   - detect result (mode/why/backend) threaded to Overview/drawer/Settings banners
 *   - GOTO_PAGE event replaces loop of NEXT_PAGE/PREV_PAGE in onSelectPage
 *   - Keyboard nav: ArrowLeft/[ and ArrowRight/] → PREV_PAGE/NEXT_PAGE in workbench
 *   Remaining: page grid real thumbs (OQ-4), before-pane source degradation (OQ-5)
 *
 * @see src/machines/tools/grayscaleTool.ts
 * @see src/services/tools/grayscaleTool.ts
 * @see src/pages/pipeline/toolSlot.tsx
 */

import { useMemo, useState, useEffect } from "react";
import type { ReactNode } from "react";
import { useActor } from "@xstate/react";
import { useParams } from "react-router-dom";
import { Icon } from "@pdomain/pdomain-ui/icons";
import {
  grayscaleToolMachine,
  type GrayscaleToolServices,
  type GrayscaleMode,
} from "@/machines/tools/grayscaleTool";
import type { ToolSlotProps } from "../toolSlot";
import { Button } from "@/components/ui/Button";
import { buildRealGrayscaleToolServices } from "@/services/tools/grayscaleTool";
import type { GrayscaleTab } from "./grayscale/types";
import { GrayscaleTabBar } from "./grayscale/GrayscaleTabBar";
import { GrayscaleOverviewTab } from "./grayscale/GrayscaleOverview";
import { GrayscalePagesTab } from "./grayscale/GrayscalePages";
import { GrayscaleWorkbenchTab } from "./grayscale/GrayscaleWorkbench";
import { GrayscaleSettingsTab } from "./grayscale/GrayscaleSettings";

// ---------------------------------------------------------------------------
// Loading / converting inline banners
// ---------------------------------------------------------------------------

function DetectingBanner(): ReactNode {
  return (
    <div
      data-testid="autodetect-banner-detecting"
      style={{
        padding: "10px 14px",
        borderRadius: 8,
        background: "color-mix(in oklab, var(--accent) 6%, var(--bg-surface))",
        border:
          "1px solid color-mix(in oklab, var(--accent) 30%, var(--border-1))",
        fontSize: 13,
        color: "var(--ink-2)",
        display: "flex",
        alignItems: "center",
        gap: 10,
      }}
    >
      <Icon name="refresh" size={12} color="var(--accent)" />
      Detecting source profile from 8 sample pages…
    </div>
  );
}

function ConvertingBanner({ done }: { done: number }): ReactNode {
  return (
    <div
      data-testid="converting-progress"
      style={{
        padding: "8px 12px",
        background: "color-mix(in oklab, var(--ocr) 8%, var(--bg-surface))",
        border:
          "1px solid color-mix(in oklab, var(--ocr) 30%, var(--border-1))",
        borderRadius: 7,
        fontSize: 12,
        color: "var(--ocr)",
      }}
    >
      Converting pages… {done} done
    </div>
  );
}

// ---------------------------------------------------------------------------
// Error state
// ---------------------------------------------------------------------------

function GrayscaleError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}): ReactNode {
  return (
    <div
      data-testid="grayscale-tool-error"
      style={{ padding: 24, textAlign: "center", color: "var(--mismatch)" }}
    >
      <div style={{ marginBottom: 12 }}>Detection failed.</div>
      <div style={{ marginBottom: 12, fontSize: 12, color: "var(--ink-3)" }}>
        {message}
      </div>
      <Button variant="outline" size="sm" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

/**
 * GrayscaleTool — high-fidelity tool slot surface for the Grayscale stage.
 *
 * @see src/pages/pipeline/toolSlot.tsx — F5 contract
 */
export function GrayscaleTool({
  stageId: _stageId,
  runnerRef: _runnerRef,
  _testServices,
}: ToolSlotProps & { _testServices?: GrayscaleToolServices }) {
  const { projectId = "demo" } = useParams<{ projectId: string }>();

  const services = useMemo(
    () => _testServices ?? buildRealGrayscaleToolServices(),
    [_testServices],
  );

  const [snapshot, send] = useActor(grayscaleToolMachine, {
    input: {
      projectId,
      stageIndex: 0,
      services,
    },
  });

  const ctx = snapshot.context;

  // Derive top-level machine state
  const topState = (() => {
    if (snapshot.matches("detecting")) return "detecting";
    if (snapshot.matches("converting")) return "converting";
    if (snapshot.matches("done")) return "done";
    if (snapshot.matches("error")) return "error";
    return "unknown";
  })();

  // Tab state — default to "workbench" as it's the focal tab per spec
  const [activeTab, setActiveTab] = useState<GrayscaleTab>("workbench");

  // Determine settings state for drawer
  const settingsState = ctx.draft != null ? "modified" : "default";

  // ── Event handlers ───────────────────────────────────────────────────────
  const handleSetFilter = (v: "all" | "perceptual" | "standard") =>
    send({ type: "SET_FILTER", value: v });

  const handlePrev = () => send({ type: "PREV_PAGE" });
  const handleNext = () => send({ type: "NEXT_PAGE" });

  const handleSetMode = (mode: GrayscaleMode) =>
    send({ type: "SET_MODE", mode });

  const handlePatch = (patch: Record<string, unknown>) =>
    send({ type: "SET_PARAM", patch });

  const handleRevert = () => send({ type: "RESET" });
  const handleSaveDefault = () => {
    const draft = ctx.draft ?? {};
    void ctx.services.saveAsDefault(projectId, "grayscale", draft);
  };
  const handleRedetect = () => send({ type: "REDETECT" });
  const handleApplyRun = () => send({ type: "APPLY_RUN" });
  const handleRerunPage = () => send({ type: "RERUN_PAGE" });

  // Keyboard navigation in workbench tab (ArrowLeft/[ → PREV_PAGE, ArrowRight/] → NEXT_PAGE)
  // Must be declared before any early returns to satisfy rules-of-hooks.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (activeTab !== "workbench") return;
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      )
        return;
      if (e.key === "ArrowLeft" || e.key === "[") {
        send({ type: "PREV_PAGE" });
      } else if (e.key === "ArrowRight" || e.key === "]") {
        send({ type: "NEXT_PAGE" });
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeTab, send]);

  // ── Error state ──────────────────────────────────────────────────────────
  if (topState === "error") {
    return (
      <GrayscaleError
        message={ctx.error?.message ?? "Unknown error"}
        onRetry={() => send({ type: "RETRY" })}
      />
    );
  }

  // ── Loading / in-flight states — show detecting/converting banners ────────
  // Still render the tab bar so the user can navigate to Overview
  const showLoadingBanner =
    topState === "detecting" || topState === "converting";

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div
      data-testid="grayscale-tool"
      style={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        minHeight: 0,
      }}
    >
      {/* Tab bar */}
      <GrayscaleTabBar
        active={activeTab}
        onChange={(tab) => setActiveTab(tab)}
        {...(ctx.pages.length > 0 && { pageCount: ctx.pages.length })}
      />

      {/* In-flight banners (detecting / converting) */}
      {showLoadingBanner && (
        <div style={{ padding: "14px 28px 0" }}>
          {topState === "detecting" ? (
            <DetectingBanner />
          ) : (
            <ConvertingBanner done={ctx.pages.length} />
          )}
        </div>
      )}

      {/* Tab bodies */}
      {activeTab === "overview" && (
        <GrayscaleOverviewTab
          pages={ctx.pages}
          detected={ctx.detected}
          backend={ctx.backend}
          onRedetect={handleRedetect}
        />
      )}

      {activeTab === "pages" && (
        <GrayscalePagesTab
          pages={ctx.pages}
          filter={ctx.filter}
          onSetFilter={handleSetFilter}
          cursor={ctx.cursor}
          onSelectPage={(idx) => {
            send({ type: "GOTO_PAGE", idx });
          }}
          backend={ctx.backend}
          projectId={projectId}
        />
      )}

      {activeTab === "workbench" && (
        <GrayscaleWorkbenchTab
          projectId={projectId}
          pages={ctx.pages}
          cursor={ctx.cursor}
          backend={ctx.backend}
          draft={ctx.draft}
          detected={ctx.detected}
          settingsState={settingsState}
          onPrev={handlePrev}
          onNext={handleNext}
          onSetMode={handleSetMode}
          onPatch={handlePatch}
          onRevert={handleRevert}
          onSaveDefault={handleSaveDefault}
          onRedetect={handleRedetect}
          onApplyRun={handleApplyRun}
          onRerunPage={handleRerunPage}
        />
      )}

      {activeTab === "settings" && (
        <GrayscaleSettingsTab
          backend={ctx.backend}
          draft={ctx.draft}
          detected={ctx.detected}
          onSetMode={handleSetMode}
          onPatch={handlePatch}
          onRedetect={handleRedetect}
          pageCount={ctx.pages.length}
        />
      )}
    </div>
  );
}
