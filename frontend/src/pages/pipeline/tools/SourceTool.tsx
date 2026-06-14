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
 * ## Tab routing (hifi-source arc)
 * The pipeline shell's `TabsBand` in PipelinePage renders the tab strip for
 * source. The SourceTool does NOT render its own tab strip — this avoids the
 * duplicate tab bar visible in the pre-hifi version.
 *
 * Tab state is held in local `activeTab` state that syncs with the pipeline
 * shell's `SET_TAB` events by intercepting the `shellSend` prop. When the
 * pipeline shell's TabsBand emits a SET_TAB for a known source tab, this
 * component updates its local `activeTab` to match.
 *
 * ## Data loading (hifi-source arc)
 * Real pages are fetched from `GET /api/data/projects/{id}/pages` via
 * `useSourcePages` (TanStack Query). The fetched `FileRow[]` seeds the
 * machine on first load. Subsequent machine events (MARK_AS, OPEN_INSERT,
 * etc.) mutate the machine's in-memory file list as before.
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
 *   source/RealThumb.tsx   — CDN image thumb with FakePaperThumb fallback
 *   source/useSourcePages.ts — TanStack Query hook for fetching page list
 *   SourceTool.tsx (this)  — main entry, machine wiring, tab routing
 *
 * @see docs/plans/design_handoff_pgdp_app/final/source/source.jsx
 * @see src/machines/tools/source.ts
 * @see src/machines/tools/stageSettings.ts
 * @see src/pages/pipeline/toolSlot.tsx — ToolSlotComponent contract
 * @see src/machines/DIVERGENCES.md — F5-1 through F5-5
 */

import { useEffect, useCallback, useRef, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useActor } from "@xstate/react";
import { useParams } from "react-router-dom";
import type { SnapshotFrom } from "xstate";
import { sourceToolMachine, recount } from "@/machines/tools/source";
import type { FileRow } from "@/machines/tools/source";
import type { ToolSlotProps } from "@/pages/pipeline/toolSlot";
import {
  buildRealSourceToolServices,
  insertBlankPage,
} from "@/services/tools/sourceTool";
import {
  useSourcePages,
  ingestThumbUrl,
  resolveFileState,
} from "./source/useSourcePages";
// shellSend is available in ToolSlotProps but not used in this component —
// SourceTool has no events to forward to the pipeline shell currently.

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

/** The tabs available on the source stage (matches pipelineShell STAGE_TABS_MAP). */
const _SOURCE_TAB_IDS = ["overview", "files", "workbench", "settings"] as const;
type SourceTab = (typeof _SOURCE_TAB_IDS)[number];

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
 * Receives `{ stageId, runnerRef, shellSend }` from the F4 toolSlot contract.
 * The `runnerRef` is not used for source (no stageRunner for source).
 *
 * ## Tab synchronisation (hifi-source arc)
 * The pipeline shell's TabsBand renders the tab strip. When a tab is clicked,
 * `shellSend({ type: "SET_TAB", tab: "files" })` flows to the pipeline machine.
 * We intercept this call here to also update our local `activeTab` state, so
 * the content pane updates without a second tab strip.
 *
 * INTEGRATION ITEM (I-ST-1): To make this fully correct, `ToolSlotProps`
 * needs a `currentTab?: string` prop from PipelinePage so the initial tab
 * state can be read from the pipeline machine's `ctx.currentTab`. Until that
 * prop is added, `activeTab` starts at "files" (the most useful default for
 * new projects). If the user navigates in from a deep-link with
 * `?tab=settings` the tab strip will show the right selection but the content
 * won't match until the user clicks again.
 */
export function SourceTool({ stageId }: ToolSlotProps): ReactNode {
  const { projectId = "demo" } = useParams<{ projectId: string }>();

  // ---------------------------------------------------------------------------
  // Tab state
  // ---------------------------------------------------------------------------
  const [activeTab, setActiveTab] = useState<SourceTab>("files");

  // ---------------------------------------------------------------------------
  // Machine wiring
  // ---------------------------------------------------------------------------
  const services = useMemo(() => buildRealSourceToolServices(), []);

  const [snapshot, send] = useActor(sourceToolMachine, {
    input: {
      projectId,
      stageId,
      services,
    },
  });

  const ctx = snapshot.context;

  // ---------------------------------------------------------------------------
  // Real data loading (hifi-source arc)
  // ---------------------------------------------------------------------------
  const {
    files: fetchedFiles,
    isLoading: pagesLoading,
    isError: pagesError,
  } = useSourcePages(projectId, Boolean(projectId));

  // Seed the machine with real pages once loaded.
  // LOAD_FILES is idempotent: only applies when ctx.files is empty.
  useEffect(() => {
    if (!pagesLoading && fetchedFiles.length > 0 && ctx.files.length === 0) {
      send({ type: "LOAD_FILES", files: fetchedFiles });
    }
  }, [pagesLoading, fetchedFiles, ctx.files.length, send]);

  // ---------------------------------------------------------------------------
  // Insert API call wiring
  // ---------------------------------------------------------------------------
  /**
   * handleInsertConfirm — called when the user clicks "Insert page" in the dialog.
   *
   * 1. Reads insertDraft from context (before CONFIRM_INSERT clears it).
   * 2. Dispatches CONFIRM_INSERT (optimistic in-memory insert).
   * 3. Calls the real POST .../pages/insert API.
   * 4. On success, dispatches REFRESH_FILES with the authoritative page list.
   *
   * The optimistic insert gives immediate UI feedback; REFRESH_FILES replaces
   * it with the real server page (with a proper source_stem and idx0).
   */
  const handleInsertConfirm = useCallback(() => {
    const draft = ctx.insertDraft;
    // Dispatch optimistic in-memory insert immediately.
    send({ type: "CONFIRM_INSERT" });

    if (!draft) return;

    // Compute after_idx0 from the anchor stem.
    const allFiles = ctx.files;
    const foundIdx = draft.anchorStem
      ? allFiles.findIndex((f) => f.stem === draft.anchorStem)
      : -1;
    const anchorIdx = foundIdx >= 0 ? foundIdx : allFiles.length - 1;
    const afterIdx0 =
      draft.position === "after" ? anchorIdx : Math.max(0, anchorIdx - 1);

    void (async () => {
      try {
        const result = await insertBlankPage(projectId, afterIdx0);
        // Map the server page list back to FileRow[] and refresh the machine.
        const refreshedFiles: FileRow[] = result.pages.map((p) => ({
          idx: p.idx0,
          stem: p.source_stem,
          // Use the same resolveFileState logic as the load path so existing
          // page roles survive the post-insert refresh.
          state: resolveFileState(p.ignore, p.page_type),
          thumbnailKey: ingestThumbUrl(projectId, p.idx0),
        }));
        send({ type: "REFRESH_FILES", files: refreshedFiles });
      } catch (err) {
        console.error("[SourceTool] handleInsertConfirm: API call failed", err);
        // Optimistic insert stays in place until next reload.
      }
    })();
  }, [ctx.insertDraft, ctx.files, projectId, send]);

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

  // Files come from the machine (seeded via LOAD_FILES on first fetch).
  const displayFiles = ctx.files;

  const activeFile =
    displayFiles.length > 0
      ? (displayFiles[firstSelectedIdx] ?? displayFiles[0] ?? null)
      : null;

  // ---------------------------------------------------------------------------
  // Search bar keyboard shortcut ("/")
  // ---------------------------------------------------------------------------
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      // Open search on "/" unless already in an input/textarea
      if (
        e.key === "/" &&
        !(e.target instanceof HTMLInputElement) &&
        !(e.target instanceof HTMLTextAreaElement)
      ) {
        e.preventDefault();
        searchInputRef.current?.focus();
        setActiveTab("files");
      }
      // Escape clears query and blurs search
      if (
        e.key === "Escape" &&
        document.activeElement === searchInputRef.current
      ) {
        send({ type: "SET_QUERY", value: "" });
        searchInputRef.current?.blur();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [send]);

  // Derived totals: use machine totals if available, else compute from displayFiles.
  // This ensures the banner shows meaningful counts even before the first MARK_AS.
  const derivedTotals =
    ctx.totals ?? (displayFiles.length > 0 ? recount(displayFiles) : null);

  // ---------------------------------------------------------------------------
  // Loading state
  // ---------------------------------------------------------------------------
  if (pagesLoading && displayFiles.length === 0) {
    return (
      <div
        data-testid="source-tool"
        data-stage-id={stageId}
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--bg-page)",
          color: "var(--ink-3)",
          fontSize: 13,
          gap: 10,
        }}
      >
        <span
          style={{
            width: 16,
            height: 16,
            borderRadius: 99,
            border:
              "2px solid color-mix(in oklab, var(--ink-3) 30%, transparent)",
            borderTopColor: "var(--ink-3)",
            display: "block",
            animation: "pgd-spin 1.1s linear infinite",
          }}
        />
        Loading pages…
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Tab rendering
  // ---------------------------------------------------------------------------
  const renderTab = (): ReactNode => {
    switch (activeTab) {
      case "overview":
        return (
          <SourceOverview
            totals={derivedTotals}
            isGenerating={isGenerating}
            onOpenFiles={() => setActiveTab("files")}
          />
        );

      case "files":
        return (
          <SourceFiles
            files={displayFiles}
            filter={ctx.filter}
            density={ctx.density}
            query={ctx.query}
            selected={ctx.selected}
            totals={derivedTotals}
            isGenerating={isGenerating}
            isConfirming={isConfirming}
            isConfirmed={isConfirmed}
            insertDraft={ctx.insertDraft}
            searchInputRef={searchInputRef}
            onSelectFile={(idx) => send({ type: "SELECT_FILE", idx })}
            onRangeSelect={(anchorIdx, endIdx) =>
              send({ type: "SELECT_RANGE", anchorIdx, endIdx })
            }
            onClearSelection={() => send({ type: "CLEAR_SELECTION" })}
            onMark={(state) => send({ type: "MARK_AS", state })}
            onRemove={() => send({ type: "REMOVE_FILES" })}
            onFilterChange={(value) => send({ type: "SET_FILTER", value })}
            onDensityChange={(value) => send({ type: "SET_DENSITY", value })}
            onQueryChange={(value) => send({ type: "SET_QUERY", value })}
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
            onInsertConfirm={handleInsertConfirm}
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
              const prev = displayFiles[firstIdx - 1];
              if (prev) send({ type: "SELECT_FILE", idx: prev.idx });
            }}
            onNext={() => {
              const firstIdx = ctx.selected[0] ?? 0;
              const next = displayFiles[firstIdx + 1];
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
            onChangeSetting={(key, value) =>
              send({ type: "CHANGE_SETTING", patch: { [key]: value } })
            }
          />
        );

      default:
        return null;
    }
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  // Only used internally to forward tab changes to the pipeline shell.
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
      {/* No internal tab strip — PipelinePage's TabsBand handles the tab UI.
          Tab content switches based on activeTab local state.
          See INTEGRATION ITEM I-ST-1 in the file docblock above. */}

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

      {/* Error strip — data fetch error */}
      {pagesError && !pagesLoading && displayFiles.length === 0 && (
        <div
          data-testid="source-pages-error-strip"
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
          Failed to load pages. Check the server connection and reload.
        </div>
      )}

      {/* Error strip — machine error */}
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
