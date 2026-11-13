import type { ToolSlotComponent } from "./toolSlot";
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
