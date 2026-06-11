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
import type {
  StageRunnerRef,
  PipelineShellEvent,
} from "@/machines/pipelineShell";
import { SourceTool } from "@/pages/pipeline/tools/SourceTool";
import { GrayscaleTool } from "./tools/GrayscaleTool";
import { PagesGridTool } from "./tools/PagesGridTool";
import { ImageStageReviewTool } from "./tools/ImageStageReviewTool";
import { TextZonesTool } from "./tools/TextZonesTool";
import { OcrTool } from "./tools/OcrTool";
import { PageOrderTool } from "./tools/PageOrderTool";
import { CanvasMapTool } from "./tools/CanvasMapTool";
import { IllustrationsTool } from "./tools/IllustrationsTool";
import { WordcheckTool } from "./tools/WordcheckTool";
import { HyphenJoinTool } from "./tools/HyphenJoinTool";
import { TextReviewTool } from "./tools/TextReviewTool";
import { RegexTool } from "./tools/RegexTool";
import { ValidationTool } from "./tools/ValidationTool";
import { ProofPackTool } from "./tools/ProofPackTool";
import { BuildPackageTool } from "./tools/BuildPackageTool";
import { ZipTool } from "./tools/ZipTool";
import { SubmitCheckTool } from "./tools/SubmitCheckTool";
import { ArchiveTool } from "./tools/ArchiveTool";

// ---------------------------------------------------------------------------
// Tool slot interface (F5 contract)
// ---------------------------------------------------------------------------

/**
 * Props received by every tool slot component.
 * F5 fills the TOOL_REGISTRY; each value must satisfy this interface.
 *
 * `shellSend` is optional — only tools that must notify pipelineShell
 * (e.g. PageOrderTool for W5.3 fan-out after reorder) use it.
 * Existing tools that ignore it remain unchanged.
 */
export interface ToolSlotProps {
  stageId: string;
  runnerRef: StageRunnerRef;
  /** W5.3: forward events to pipelineShell (e.g. STAGE_COMPLETED fan-out). */
  shellSend?: (event: PipelineShellEvent) => void;
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
  // F5.2 — Image-prep group (task/f52-imageprep-tools)
  grayscale: GrayscaleTool,
  crop: PagesGridTool,
  threshold: ImageStageReviewTool,
  deskew: ImageStageReviewTool,
  denoise: ImageStageReviewTool,
  dewarp: ImageStageReviewTool,
  post_transform_crop: ImageStageReviewTool,
  // W5.8 — post_ocr_crop registered (was missing, rendering placeholder)
  post_ocr_crop: ImageStageReviewTool,
  // F5.3 — OCR group (task/f53-ocr-tools)
  text_zones: TextZonesTool,
  ocr: OcrTool,
  // F5.4 — Compose group (task/f54-compose-tools)
  page_order: PageOrderTool,
  canvas_map: CanvasMapTool,
  illustrations: IllustrationsTool,
  // F5.5 — Text group (task/f55-text-tools)
  // Note: `scannocheck` is NOT registered here. The backend DAG has only
  // `wordcheck` as a real stage_id. The prior `scannocheck` key was a phantom
  // — see DIVERGENCES.md F5.5-D8 for the route-namespace note.
  wordcheck: WordcheckTool,
  hyphen_join: HyphenJoinTool,
  text_review: TextReviewTool,
  regex: RegexTool,
  // F5.6 — Pack group (task/f56-pack-tools)
  validation: ValidationTool,
  proof_pack: ProofPackTool,
  build_package: BuildPackageTool,
  zip: ZipTool,
  submit_check: SubmitCheckTool,
  archive: ArchiveTool,
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
