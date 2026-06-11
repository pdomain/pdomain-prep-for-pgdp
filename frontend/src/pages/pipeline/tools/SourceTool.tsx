/**
 * SourceTool — Source-stage tool component for the pipeline tool slot.
 *
 * Recreates the artboards from `final/source/source.jsx`:
 *   SourceFiles (generating + selection states)
 *   SourceOverview
 *   SourceStepSettings (default / modified / preset)
 *   SourcePageWorkbench
 *
 * ## Machine wiring
 * Driven by `sourceToolMachine` (machines/tools/source.ts).
 * Receives `{ stageId, runnerRef }` from the F4 toolSlot contract.
 * The `runnerRef` is NOT used directly here — the source stage has no
 * stageRunner (machine-stage-map.md §3). The runnerRef is retained in the
 * prop signature to satisfy the `ToolSlotComponent` interface contract.
 *
 * ## Artboard parity
 * Every named artboard from final/source/ is represented as a named
 * component with `data-testid` on interactive elements:
 *   - data-testid="source-banner"           — progress / marking status banner
 *   - data-testid="source-banner-generating"— generating state banner
 *   - data-testid="source-banner-selection" — selection state banner
 *   - data-testid="confirm-selection-btn"   — the guarded Confirm button
 *   - data-testid="file-toolbar"            — filter chips + density + search + insert
 *   - data-testid="filter-chip-{id}"        — individual filter chip
 *   - data-testid="density-btn-{d}"         — S/M/L density button
 *   - data-testid="file-grid"               — thumb grid container
 *   - data-testid="thumb-card-{idx}"        — individual thumb card
 *   - data-testid="insert-divider"          — hover affordance between thumbs (Src-D)
 *   - data-testid="bulk-bar"                — sticky multi-select action bar
 *   - data-testid="bulk-mark-{state}"       — mark-as button in bulk bar
 *   - data-testid="insert-dialog"           — insert-page dialog overlay
 *   - data-testid="settings-banner"         — inheritance banner
 *   - data-testid="settings-save-btn"       — "Save as project default"
 *   - data-testid="settings-revert-btn"     — "Revert"
 *   - data-testid="settings-reset-btn"      — "Reset to project default"
 *   - data-testid="workbench-role-segment"  — per-page role selector
 *   - data-testid="workbench-apply-btn"     — "Apply & Continue"
 *   - data-testid="workbench-insert-note"   — insert note display (Src-WB2)
 *
 * ## Component organisation (split for maintainability, Fix 4)
 *   SourceToolFiles.tsx    — InsertDivider, SourceBanner, FileToolbar, BulkBar,
 *                            InsertDialog, SourceFiles
 *   SourceToolOverview.tsx — SourceOverview
 *   SourceToolSettings.tsx — SourceStepSettings
 *   SourceToolWorkbench.tsx— SourcePageWorkbench
 *   SourceTool.tsx (this)  — main entry, machine wiring, tab routing
 *
 * @see docs/plans/design_handoff_pgdp_app/final/source/source.jsx
 * @see src/machines/tools/source.ts
 * @see src/machines/tools/stageSettings.ts
 * @see src/pages/pipeline/toolSlot.tsx — ToolSlotComponent contract
 * @see src/machines/DIVERGENCES.md — F5-1 through F5-5
 */

import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useActor } from "@xstate/react";
import { useParams } from "react-router-dom";
import type { SnapshotFrom } from "xstate";
import { sourceToolMachine } from "@/machines/tools/source";
import type { ToolSlotProps } from "@/pages/pipeline/toolSlot";
import { Seg } from "@/design/Seg";
import { buildRealSourceToolServices } from "@/services/tools/sourceTool";

// Sub-module imports — all exports re-exported for test convenience
export {
  InsertDivider,
  SourceBanner,
  FileToolbar,
  BulkBar,
  InsertDialog,
  SourceFiles,
} from "./SourceToolFiles";
export { SourceOverview } from "./SourceToolOverview";
export { SourceStepSettings } from "./SourceToolSettings";
export { SourcePageWorkbench } from "./SourceToolWorkbench";

import { SourceFiles } from "./SourceToolFiles";
import { SourceOverview } from "./SourceToolOverview";
import { SourceStepSettings } from "./SourceToolSettings";
import { SourcePageWorkbench } from "./SourceToolWorkbench";

/** The tabs available on the source stage. */
const SOURCE_TABS = [
  { value: "overview", label: "Overview" },
  { value: "files", label: "Files" },
  { value: "workbench", label: "Page workbench" },
  { value: "settings", label: "Stage settings" },
] as const;

type SourceTab = (typeof SOURCE_TABS)[number]["value"];

/**
 * Typed snapshot helper — avoids `as any` for parallel-state matching.
 *
 * XState v5's `SnapshotFrom<typeof machine>` gives us the full snapshot type.
 * The `matches()` method on a typed snapshot accepts the state value object,
 * avoiding the `never`-overlap issue with untyped casts.
 */
type SourceSnapshot = SnapshotFrom<typeof sourceToolMachine>;

function matchesState(
  snap: SourceSnapshot,
  partial: Record<string, string>,
): boolean {
  // snapshot.matches() accepts a partial state value; this is the canonical
  // XState v5 pattern for parallel-region matching.
  return snap.matches(partial);
}

/**
 * SourceTool — registered in TOOL_REGISTRY under `"source"`.
 *
 * Receives `{ stageId, runnerRef }` from the F4 toolSlot contract.
 * The `runnerRef` is not used for source (no stageRunner for source).
 */
export function SourceTool({ stageId }: ToolSlotProps): ReactNode {
  // useQueryClient() reserved for TanStack Query integration at I1
  const { projectId = "demo" } = useParams<{ projectId: string }>();
  const [activeTab, setActiveTab] = useState<SourceTab>("files");

  const services = useMemo(() => buildRealSourceToolServices(), []);

  const [snapshot, send] = useActor(sourceToolMachine, {
    input: {
      projectId,
      stageId,
      services,
    },
  });

  const ctx = snapshot.context;

  // Determine sub-states using typed SnapshotFrom helper (Fix 3 — no `as any`).
  const isGenerating: boolean = matchesState(snapshot, {
    thumbnails: "generating",
  });
  const isConfirming: boolean = matchesState(snapshot, {
    files: "confirming",
  });
  const isConfirmed: boolean = matchesState(snapshot, { files: "confirmed" });
  const isInserting: boolean = matchesState(snapshot, { files: "inserting" });
  const hasSelection = ctx.selected.length > 0 && !isInserting;

  // Settings transient states
  const settingsValue = (snapshot.value as Record<string, string>)["settings"];
  const isSaving = settingsValue === "saving";
  const isReverting = settingsValue === "reverting";
  const isResetting = settingsValue === "resetting";
  const settingsState = ctx.settingsState;
  const settingsDisplayState: Parameters<
    typeof SourceStepSettings
  >[0]["settingsState"] = isSaving
    ? "saving"
    : isReverting
      ? "reverting"
      : isResetting
        ? "resetting"
        : settingsState;

  // Active page for workbench tab
  const firstSelectedIdx = ctx.selected[0] ?? 0;
  const activeFile =
    ctx.files.length > 0
      ? (ctx.files[firstSelectedIdx] ?? ctx.files[0] ?? null)
      : null;

  // Tab rendering
  const renderTab = (): ReactNode => {
    switch (activeTab) {
      case "overview":
        return (
          <SourceOverview
            totals={ctx.totals}
            isGenerating={isGenerating}
            onOpenFiles={() => setActiveTab("files")}
          />
        );

      case "files":
        return (
          <SourceFiles
            files={ctx.files}
            filter={ctx.filter}
            density={ctx.density}
            query={ctx.query}
            selected={ctx.selected}
            totals={ctx.totals}
            isGenerating={isGenerating}
            isConfirming={isConfirming}
            isConfirmed={isConfirmed}
            insertDraft={ctx.insertDraft}
            onSelectFile={(idx) => send({ type: "SELECT_FILE", idx })}
            onClearSelection={() => send({ type: "CLEAR_SELECTION" })}
            onMark={(state) => send({ type: "MARK_AS", state })}
            onRemove={() => send({ type: "REMOVE_FILES" })}
            onFilterChange={(value) => send({ type: "SET_FILTER", value })}
            onDensityChange={(value) => send({ type: "SET_DENSITY", value })}
            onInsertOpen={(anchorStem) =>
              send({
                type: "OPEN_INSERT",
                ...(anchorStem
                  ? { anchorStem }
                  : activeFile?.stem
                    ? { anchorStem: activeFile.stem }
                    : {}),
              })
            }
            onInsertPatch={(patch) => send({ type: "SET_INSERT_FIELD", patch })}
            onInsertConfirm={() => send({ type: "CONFIRM_INSERT" })}
            onInsertCancel={() => send({ type: "CANCEL_INSERT" })}
            onConfirmSelection={() => send({ type: "CONFIRM_SELECTION" })}
          />
        );

      case "workbench":
        return (
          <SourcePageWorkbench
            file={activeFile}
            onRoleChange={(idx, role) => send({ type: "SET_ROLE", idx, role })}
            onApply={() => {
              // Apply & Continue: clear selection, advance tab
              send({ type: "CLEAR_SELECTION" });
              setActiveTab("files");
            }}
            onPrev={() => {
              const firstIdx = ctx.selected[0] ?? 0;
              const prev = ctx.files[firstIdx - 1];
              if (prev) send({ type: "SELECT_FILE", idx: prev.idx });
            }}
            onNext={() => {
              const firstIdx = ctx.selected[0] ?? 0;
              const next = ctx.files[firstIdx + 1];
              if (next) send({ type: "SELECT_FILE", idx: next.idx });
            }}
          />
        );

      case "settings":
        return (
          <SourceStepSettings
            settingsState={settingsDisplayState}
            draft={ctx._settingsDraft}
            presetId={ctx._presetId}
            isSaving={isSaving || isReverting || isResetting}
            onSaveAsDefault={() => send({ type: "SAVE_AS_DEFAULT" })}
            onRevert={() => send({ type: "REVERT" })}
            onResetToDefault={() => send({ type: "RESET_TO_DEFAULT" })}
          />
        );

      default:
        return null;
    }
  };

  return (
    <div
      data-testid="source-tool"
      data-stage-id={stageId}
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        background: "var(--bg-page)",
      }}
    >
      {/* Tab strip */}
      <div
        style={{
          padding: "0 28px",
          borderBottom: "1px solid var(--border-1)",
          background: "var(--bg-surface)",
        }}
      >
        <Seg
          data-testid="source-tabs"
          items={SOURCE_TABS.map((t) => ({ value: t.value, label: t.label }))}
          value={activeTab}
          onChange={(v) => setActiveTab(v as SourceTab)}
        />
      </div>

      {/* Tab content */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: "auto",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {renderTab()}
      </div>

      {/* Error strip */}
      {ctx.error && (
        <div
          data-testid="source-error-strip"
          style={{
            padding: "8px 28px",
            background:
              "color-mix(in oklab, var(--mismatch) 10%, var(--bg-surface))",
            borderTop:
              "1px solid color-mix(in oklab, var(--mismatch) 40%, var(--border-1))",
            fontSize: 12,
            color: "var(--mismatch)",
          }}
        >
          {ctx.error}
        </div>
      )}

      {/* Selection status hint */}
      {hasSelection && (
        <div
          style={{
            padding: "4px 28px",
            background: "var(--bg-raised)",
            borderTop: "1px solid var(--border-1)",
            fontSize: 11,
            color: "var(--ink-4)",
            fontFamily: "var(--mono-font)",
          }}
        >
          {ctx.selected.length} selected — click "Page workbench" to inspect
          this page
        </div>
      )}
    </div>
  );
}
