/**
 * Typed toast helpers — thin wrapper around Sonner so callers never import
 * from "sonner" directly.  Each helper maps to a Sonner variant:
 *   toast.info    → default (no data-type  → --accent left edge)
 *   toast.success → success (data-type="success" → --status-done left edge)
 *   toast.warn    → warning (data-type="warning" → --status-review left edge)
 *   toast.error   → error   (data-type="error"   → --status-error left edge)
 *
 * Token CSS for the left-edge colouring lives in styles/tokens.css under the
 * "Sonner toast token overrides" section.
 */
import { toast as sonnerToast } from "sonner";

export const toast = {
  info: (msg: string) => sonnerToast(msg),
  success: (msg: string) => sonnerToast.success(msg),
  warn: (msg: string) => sonnerToast.warning(msg),
  error: (msg: string) => sonnerToast.error(msg),
};
