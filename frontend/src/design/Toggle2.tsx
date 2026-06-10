/**
 * Toggle2 — two-way toggle control for stage settings panels.
 *
 * A binary on/off toggle. Evaluated against pdomain-ui's `ToggleGroup` and
 * the repo's existing `ToggleGroup.tsx` (which wraps Radix ToggleGroup).
 * The PGDP `Toggle2` shape is a simple two-value toggle with an inline
 * label and boolean checked state — it does not match ToggleGroup's multi-
 * item selection API. App-local implementation kept.
 *
 * RECONCILIATION: `ToggleGroup` in `components/ui/ToggleGroup.tsx` is a
 * multi-item selection widget (Radix ToggleGroup). `Toggle2` is a simpler
 * binary switch. Both coexist; `Toggle2` lives in `design/` while
 * `ToggleGroup` lives in `components/ui/`.
 *
 * Disposition: stays app-local (see docs/specs/library-placement.md §1.3).
 *
 * Token-only styling; no hex literals.
 */
import { cn } from "@/lib/utils";

export interface Toggle2Props {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Optional label rendered beside the toggle. */
  label?: string;
  disabled?: boolean;
  className?: string;
  "data-testid"?: string;
  "data-screen-label"?: string;
}

export function Toggle2({
  checked,
  onChange,
  label,
  disabled = false,
  className,
  "data-testid": testId,
  "data-screen-label": screenLabel,
}: Toggle2Props) {
  return (
    <label
      data-testid={testId ?? "toggle2"}
      data-screen-label={screenLabel}
      data-checked={checked}
      className={cn(
        "inline-flex items-center gap-2 cursor-pointer select-none",
        disabled && "opacity-50 cursor-not-allowed",
        className,
      )}
    >
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative inline-flex h-5 w-9 flex-shrink-0 rounded-full border-2 border-transparent",
          "transition-colors focus-visible:outline-none focus-visible:ring-2",
          "focus-visible:ring-offset-2 focus-visible:ring-offset-bg-surface",
          checked
            ? "bg-[color:var(--accent)]"
            : "bg-bg-raised border border-border-2",
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            "pointer-events-none inline-block h-4 w-4 rounded-full bg-[color:var(--accent-ink)] shadow",
            "ring-0 transition-transform",
            checked ? "translate-x-4" : "translate-x-0",
          )}
        />
      </button>
      {label ? (
        <span className="text-sm text-ink-1 font-medium">{label}</span>
      ) : null}
    </label>
  );
}
