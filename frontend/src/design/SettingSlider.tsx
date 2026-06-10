/**
 * SettingSlider — numeric slider for stage step-settings panels.
 *
 * Evaluated against pdomain-ui Progress: Progress is a read-only progress
 * indicator; it has no interactive range semantics. No matching pdomain-ui
 * slider primitive exists (confirmed: no Slider/Range in primitives.d.ts).
 * App-local implementation kept.
 *
 * Disposition: stays app-local (see docs/specs/library-placement.md §1.3).
 *
 * Token-only styling; no hex literals.
 */
import { cn } from "@/lib/utils";

export interface SettingSliderProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  /** Optional unit label shown after the value (e.g. "%", "px"). */
  unit?: string;
  disabled?: boolean;
  className?: string;
  "data-testid"?: string;
  "data-screen-label"?: string;
}

export function SettingSlider({
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  unit,
  disabled = false,
  className,
  "data-testid": testId,
  "data-screen-label": screenLabel,
}: SettingSliderProps) {
  return (
    <div
      data-testid={testId ?? "setting-slider"}
      data-screen-label={screenLabel}
      className={cn("flex items-center gap-3", className)}
    >
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className={cn(
          "h-1.5 w-full flex-1 cursor-pointer appearance-none rounded-full",
          "bg-bg-raised accent-[color:var(--accent)]",
          disabled && "opacity-50 cursor-not-allowed",
        )}
      />
      <span className="min-w-[2.5rem] text-right font-mono text-xs text-ink-2 tabular-nums">
        {value}
        {unit ?? ""}
      </span>
    </div>
  );
}
