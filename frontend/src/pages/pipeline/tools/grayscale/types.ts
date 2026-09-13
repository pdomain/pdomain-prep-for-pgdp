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

// Task 4.1 — pipeline config types
export type { GrayscaleConverter, GrayscaleChannel } from "./grayscaleConfig";

export type GrayscaleTab = "overview" | "pages" | "workbench" | "settings";
