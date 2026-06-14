/**
 * Shared type aliases for the Grayscale tool sub-components.
 * Re-exports from the machine plus tab type.
 */

export type {
  GrayscaleMode,
  GrayscaleBackend,
  GrayscalePage,
  GrayscaleDetected,
  GrayscaleDraft,
} from "@/machines/tools/grayscaleTool";

export type GrayscaleTab = "overview" | "pages" | "workbench" | "settings";
