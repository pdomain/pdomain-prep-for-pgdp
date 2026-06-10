/**
 * Check — checkbox with PGDP tone/label pairing.
 *
 * Used in submit_check, validation, and build_package stage tools.
 * Evaluated against pdomain-ui: no `CheckIcon + generic checkbox` pattern
 * is exported from pdomain-ui's primitives that includes tone semantics.
 * The PGDP `Check` needs tone-aware styling (clean/error/neutral) and a
 * label. App-local implementation kept.
 *
 * Disposition: stays app-local (see docs/specs/library-placement.md §1.3).
 *
 * Token-only styling; no hex literals.
 */
import { cn } from "@/lib/utils";

export type CheckTone = "clean" | "error" | "neutral";

const TONE_CLASSES: Record<CheckTone, string> = {
  clean:
    "border-[color:var(--exact)] data-[checked=true]:bg-[color:var(--exact)] data-[checked=true]:border-[color:var(--exact)]",
  error:
    "border-[color:var(--mismatch)] data-[checked=true]:bg-[color:var(--mismatch)] data-[checked=true]:border-[color:var(--mismatch)]",
  neutral:
    "border-border-2 data-[checked=true]:bg-[color:var(--accent)] data-[checked=true]:border-[color:var(--accent)]",
};

export interface CheckProps {
  checked: boolean;
  onChange?: (checked: boolean) => void;
  /** Text label. */
  label: string;
  /** Optional sub-description. */
  description?: string;
  tone?: CheckTone;
  disabled?: boolean;
  className?: string;
  "data-testid"?: string;
  "data-screen-label"?: string;
}

export function Check({
  checked,
  onChange,
  label,
  description,
  tone = "neutral",
  disabled = false,
  className,
  "data-testid": testId,
  "data-screen-label": screenLabel,
}: CheckProps) {
  return (
    <label
      data-testid={testId ?? "check"}
      data-screen-label={screenLabel}
      data-checked={checked}
      data-tone={tone}
      className={cn(
        "flex items-start gap-3 cursor-pointer select-none",
        disabled && "opacity-50 cursor-not-allowed",
        className,
      )}
    >
      <div
        data-checked={checked}
        className={cn(
          "mt-0.5 flex h-4 w-4 flex-none items-center justify-center rounded border",
          "transition-colors",
          TONE_CLASSES[tone],
        )}
      >
        {checked ? (
          <svg
            viewBox="0 0 24 24"
            width={10}
            height={10}
            fill="none"
            stroke="var(--accent-ink)"
            strokeWidth={3}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        ) : null}
      </div>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange?.(e.target.checked)}
        className="sr-only"
        aria-label={label}
      />
      <div className="flex flex-col gap-0.5 min-w-0">
        <span className="text-sm font-medium text-ink-1 leading-tight">
          {label}
        </span>
        {description ? (
          <span className="text-xs text-ink-3 leading-snug">{description}</span>
        ) : null}
      </div>
    </label>
  );
}
