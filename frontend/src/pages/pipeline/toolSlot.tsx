/**
 * toolSlot.tsx — F5 tool slot interface and placeholder.
 *
 * This file defines the contract that F5 stage tools must satisfy.
 * Each stage's tool is registered in the TOOL_REGISTRY below.
 * Until F5 fills the registry, all stages render the placeholder panel.
 *
 * ## F5 Contract
 * Each tool entry implements `ToolSlotComponent`:
 *   - Receives `stageId: string` and `runnerRef: StageRunnerRef`.
 *   - Renders whatever UI the stage's workbench/tool tab needs.
 *   - The registry key is the `stageId`.
 *
 * ## Placeholder policy (visible OK here)
 * The "tool not yet implemented" placeholder is intentionally visible — F5
 * will fill it within this same plan. The placeholder is marked with
 * `data-testid="tool-slot-placeholder"` and a clear "F5 pending" label.
 * See DIVERGENCES.md F4-5.
 *
 * @see docs/plans/2026-06-10-statechart-convergence.md — Task F5
 */

import type { ReactNode } from "react";
import type { StageRunnerRef } from "@/machines/pipelineShell";
import { SourceTool } from "@/pages/pipeline/tools/SourceTool";

// ---------------------------------------------------------------------------
// Tool slot interface (F5 contract)
// ---------------------------------------------------------------------------

/**
 * Props received by every tool slot component.
 * F5 fills the TOOL_REGISTRY; each value must satisfy this interface.
 */
export interface ToolSlotProps {
  stageId: string;
  runnerRef: StageRunnerRef;
}

export type ToolSlotComponent = (props: ToolSlotProps) => ReactNode;

// ---------------------------------------------------------------------------
// Tool registry
// ---------------------------------------------------------------------------

/**
 * Map from stageId → ToolSlotComponent.
 * F5 will populate this with stage-specific tool components.
 * Until then, `resolveToolSlot` returns the placeholder for every stage.
 */
export const TOOL_REGISTRY: Partial<Record<string, ToolSlotComponent>> = {
  // F5.1 — Source stage tool (task/f51-source-tool)
  source: SourceTool,
};

/**
 * Look up the registered tool for a stage, falling back to the placeholder.
 */
export function resolveToolSlot(stageId: string): ToolSlotComponent {
  return TOOL_REGISTRY[stageId] ?? ToolSlotPlaceholder;
}

// ---------------------------------------------------------------------------
// Placeholder — visible per workspace spec-acceptance rule
// ---------------------------------------------------------------------------

/**
 * Placeholder shown when F5 has not yet registered a tool for a stage.
 * The placeholder is visible + labeled so F5 can locate and replace it.
 * `data-testid="tool-slot-placeholder"` is the testid for artboard tests.
 */
function ToolSlotPlaceholder({ stageId }: ToolSlotProps): ReactNode {
  return (
    <div
      data-testid="tool-slot-placeholder"
      data-stage-id={stageId}
      style={{
        flex: 1,
        minHeight: 480,
        border: "1px dashed var(--border-2)",
        borderRadius: 10,
        background:
          "repeating-linear-gradient(135deg, transparent 0 14px, color-mix(in oklab, var(--border-1) 35%, transparent) 14px 15px)",
        display: "grid",
        placeItems: "center",
        color: "var(--ink-3)",
      }}
    >
      <div
        style={{
          textAlign: "center",
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        <div
          style={{
            fontFamily: "monospace",
            fontSize: 11,
            color: "var(--ink-4)",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
          }}
        >
          tool slot · F5 pending
        </div>
        <div style={{ fontSize: 13, color: "var(--ink-3)" }}>
          Stage tool for{" "}
          <span style={{ fontFamily: "monospace", fontWeight: 600 }}>
            {stageId}
          </span>{" "}
          will be implemented in Task F5.
        </div>
      </div>
    </div>
  );
}
