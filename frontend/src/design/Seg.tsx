/**
 * Seg — abbreviated segment/tab row used in pack-group stage tools.
 *
 * A compact horizontal tab selector, styled for dense pack-group tool UIs.
 * Distinct from the pdomain-ui `Segmented` control (which is a mutually-
 * exclusive inline selector with option objects API). `Seg` is a simpler
 * tab bar with direct `value`/`onChange` and children rendering.
 *
 * RECONCILIATION: The repo's existing `ToggleGroup.tsx` wraps Radix ToggleGroup.
 * `Seg` is a lighter, visually distinct component (tab bar aesthetic, not toggle
 * pill aesthetic). Both are kept; callers choose the appropriate primitive.
 *
 * Disposition: stays app-local (see docs/specs/library-placement.md §1.3).
 *
 * Token-only styling; no hex literals.
 */
import { cn } from "@/lib/utils";

export interface SegItem {
  value: string;
  label: string;
}

export interface SegProps {
  items: SegItem[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
  "data-testid"?: string;
  "data-screen-label"?: string;
}

export function Seg({
  items,
  value,
  onChange,
  className,
  "data-testid": testId,
  "data-screen-label": screenLabel,
}: SegProps) {
  return (
    <div
      data-testid={testId ?? "seg"}
      data-screen-label={screenLabel}
      role="tablist"
      className={cn(
        "flex items-center gap-0 border border-border-2 rounded-md overflow-hidden bg-bg-sunk",
        className,
      )}
    >
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            role="tab"
            type="button"
            aria-selected={active}
            data-state={active ? "active" : "inactive"}
            onClick={() => onChange(item.value)}
            className={cn(
              "h-7 px-3 text-xs font-medium whitespace-nowrap transition-colors",
              active
                ? "bg-bg-raised text-ink-1 shadow-sm"
                : "bg-transparent text-ink-3 hover:text-ink-2 hover:bg-bg-surface",
            )}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
