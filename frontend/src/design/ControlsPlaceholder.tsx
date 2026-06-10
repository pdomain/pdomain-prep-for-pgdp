/**
 * ControlsPlaceholder — dev/design-time placeholder for the controls slot.
 *
 * Striped placeholder that fills the Breadcrumb content-controls slot,
 * making the slot's shape visible on static artboards. Replace by passing
 * a real `controls={…}` prop to the Breadcrumb / AppTemplate in production.
 *
 * This is a **dev-only** component used in design canvas artboards and
 * Storybook fixtures. It should not appear in any production page.
 *
 * Disposition: stays app-local (see docs/specs/library-placement.md §1.2).
 *
 * Token-only styling; no hex literals.
 */
import { cn } from "@/lib/utils";

export interface ControlsPlaceholderProps {
  /** Width of the placeholder strip. Defaults to 460. */
  width?: number;
  className?: string;
  "data-testid"?: string;
}

export function ControlsPlaceholder({
  width = 460,
  className,
  "data-testid": testId,
}: ControlsPlaceholderProps) {
  return (
    <div
      data-testid={testId ?? "controls-placeholder"}
      style={{
        width,
        backgroundImage:
          "repeating-linear-gradient(135deg, transparent 0 8px, color-mix(in srgb, var(--border-1) 50%, transparent) 8px 9px)",
      }}
      className={cn(
        "h-6 rounded-md border border-dashed border-border-2",
        "flex items-center justify-center",
        "font-mono text-[10px] uppercase tracking-[0.08em] text-ink-4",
        className,
      )}
    >
      content controls
    </div>
  );
}
