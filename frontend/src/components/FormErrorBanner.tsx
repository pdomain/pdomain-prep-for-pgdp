/**
 * FormErrorBanner — fires a sonner `toast.error` whenever its `error` prop
 * transitions to a real Error.
 *
 * §13a step 2: the inline `<span role="alert">` body retired in favor of the
 * global `<Toaster>` mounted at the app root in `main.tsx`. The component
 * is now side-effect-only (returns null) so call sites stay declarative —
 * pass an error, the toast plumbing happens here.
 *
 * Dedup: the toast fires once per distinct Error reference. Re-renders with
 * the same Error don't re-toast (covers React strict-mode double-render
 * and benign re-renders from sibling state).
 */
import { useEffect, useRef } from "react";
import { toast } from "../lib/toast";

export interface FormErrorBannerProps {
  /** Short label shown before the error message (e.g. "save failed"). */
  prefix: string;
  /** The error to surface, or null/undefined for no toast. */
  error: Error | null | undefined;
}

export function FormErrorBanner({ prefix, error }: FormErrorBannerProps) {
  const lastFired = useRef<Error | null>(null);

  useEffect(() => {
    if (!error) return;
    if (lastFired.current === error) return;
    lastFired.current = error;
    toast.error(`${prefix}: ${error.message}`);
  }, [prefix, error]);

  return null;
}
