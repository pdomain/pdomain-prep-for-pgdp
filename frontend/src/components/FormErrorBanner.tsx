/**
 * FormErrorBanner — inline mutation-error display.
 *
 * Consolidates the three duplicated `<span class="text-xs text-red-600">…</span>`
 * sites in TextReviewPage (save / re-OCR / delete-words). Step 1 of the
 * §13a path: same DOM/visual contract as the inline spans, but routed through
 * one component so the later sonner/Toast swap is a single edit.
 *
 * Returns null when `error` is null/undefined so callers can render
 * unconditionally inside JSX without wrapper guards.
 */
export interface FormErrorBannerProps {
  /** Short label shown before the error message (e.g. "save failed"). */
  prefix: string;
  /** The error to surface, or null/undefined to render nothing. */
  error: Error | null | undefined;
}

export function FormErrorBanner({ prefix, error }: FormErrorBannerProps) {
  if (!error) return null;
  return (
    <span role="alert" className="text-xs text-red-600">
      {prefix}: {error.message}
    </span>
  );
}
