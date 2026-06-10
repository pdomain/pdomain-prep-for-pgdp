/**
 * Gate — confirmation gate banner for the PGDP pipeline gate chain.
 *
 * Shows a status banner (e.g. "validation passed before build") that
 * confirms a prerequisite gate has been satisfied or indicates a blocker.
 * Used in the validation → build → zip → submit chain stage tools.
 *
 * Disposition: stays app-local (see docs/specs/library-placement.md §1.3).
 * PGDP-specific gate-chain UI.
 *
 * Token-only styling; no hex literals.
 */
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type GateTone = "passed" | "blocked" | "pending" | "warning";

const TONE_CLASSES: Record<GateTone, string> = {
  passed:
    "border-[color:var(--exact)] bg-[color:color-mix(in_srgb,var(--exact)_8%,transparent)] text-[color:var(--exact)]",
  blocked:
    "border-[color:var(--mismatch)] bg-[color:color-mix(in_srgb,var(--mismatch)_8%,transparent)] text-[color:var(--mismatch)]",
  pending: "border-border-2 bg-bg-raised text-ink-3",
  warning:
    "border-[color:var(--fuzzy)] bg-[color:color-mix(in_srgb,var(--fuzzy)_8%,transparent)] text-[color:var(--fuzzy)]",
};

export interface GateProps {
  tone?: GateTone;
  /** Primary label (e.g. "Validation passed"). */
  label: string;
  /** Optional sub-text shown below the label. */
  detail?: string;
  /** Optional action slot rendered at the trailing edge (e.g. a Button). */
  action?: ReactNode;
  className?: string;
  "data-testid"?: string;
  "data-screen-label"?: string;
  "data-comment-anchor"?: string;
}

export function Gate({
  tone = "pending",
  label,
  detail,
  action,
  className,
  "data-testid": testId,
  "data-screen-label": screenLabel,
  "data-comment-anchor": commentAnchor,
}: GateProps) {
  return (
    <div
      data-testid={testId ?? "gate"}
      data-gate-tone={tone}
      data-screen-label={screenLabel}
      data-comment-anchor={commentAnchor}
      className={cn(
        "flex items-center gap-3 rounded-md border px-4 py-3",
        TONE_CLASSES[tone],
        className,
      )}
    >
      <div className="flex flex-col gap-0.5 flex-1 min-w-0">
        <span className="text-sm font-semibold leading-tight">{label}</span>
        {detail ? (
          <span className="text-xs text-ink-3 font-normal">{detail}</span>
        ) : null}
      </div>
      {action ? <div className="flex-none">{action}</div> : null}
    </div>
  );
}
