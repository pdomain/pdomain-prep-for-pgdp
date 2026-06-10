/**
 * SetRow (SettingRow) — settings row layout for stage settings panels.
 *
 * A label + control row for stage step-settings panels. Evaluated against
 * pdomain-ui `FieldRow`: pdomain-ui's FieldRow only extends
 * `HTMLAttributes<HTMLDivElement>` with no additional props — it is a layout
 * container without label/description semantics. The PGDP `SettingRow` shape
 * (label text + optional description + control slot) diverges enough to
 * justify keeping it app-local.
 *
 * Disposition: stays app-local (see docs/specs/library-placement.md §1.3).
 * Evaluation result: pdomain-ui FieldRow has no label/description API;
 * app-local shape kept.
 *
 * Token-only styling; no hex literals.
 */
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface SetRowProps {
  /** Label text shown at the left. */
  label: string;
  /** Optional sub-description below the label. */
  description?: string;
  /** The control rendered at the right (input, toggle, slider, etc.). */
  children?: ReactNode;
  className?: string;
  "data-testid"?: string;
  "data-screen-label"?: string;
}

export function SetRow({
  label,
  description,
  children,
  className,
  "data-testid": testId,
  "data-screen-label": screenLabel,
}: SetRowProps) {
  return (
    <div
      data-testid={testId ?? "set-row"}
      data-screen-label={screenLabel}
      className={cn("flex items-center justify-between gap-4 py-2", className)}
    >
      <div className="flex flex-col gap-0.5 min-w-0">
        <span className="text-sm font-medium text-ink-1 leading-tight">
          {label}
        </span>
        {description ? (
          <span className="text-xs text-ink-3 leading-snug">{description}</span>
        ) : null}
      </div>
      {children ? <div className="flex-none">{children}</div> : null}
    </div>
  );
}

// SettingRow: callers should use SetRow directly.
// The alias is intentionally not exported to avoid knip duplicate-export warnings.
