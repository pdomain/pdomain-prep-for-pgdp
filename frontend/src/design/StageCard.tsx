/**
 * StageCard — per-stage card atom used across pack-group stage tools.
 *
 * A bordered, padded card surface for stage-specific content. Named
 * `StageCard` to avoid shadowing the generic `Card` from pdomain-ui
 * (which is a tile/media card, not a stage step card).
 *
 * RECONCILIATION: The existing repo has `src/components/ui/Card.tsx` (Radix
 * AlertDialog-based, used in dialog patterns). That component is a different
 * shape and different import path. `StageCard` is new and distinct; the old
 * `Card` is preserved unchanged. Do not delete `components/ui/Card.tsx`.
 *
 * Disposition: stays app-local (see docs/specs/library-placement.md §1.3).
 *
 * Token-only styling; no hex literals.
 */
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface StageCardProps {
  /** Optional card title (rendered as a small label above the body). */
  title?: string;
  children?: ReactNode;
  className?: string;
  "data-testid"?: string;
  "data-screen-label"?: string;
  "data-comment-anchor"?: string;
}

export function StageCard({
  title,
  children,
  className,
  "data-testid": testId,
  "data-screen-label": screenLabel,
  "data-comment-anchor": commentAnchor,
}: StageCardProps) {
  return (
    <div
      data-testid={testId ?? "stage-card"}
      data-screen-label={screenLabel}
      data-comment-anchor={commentAnchor}
      className={cn(
        "rounded-md border border-border-1 bg-bg-surface p-4 flex flex-col gap-3",
        className,
      )}
    >
      {title ? (
        <span className="text-xs font-medium text-ink-3 uppercase tracking-wide">
          {title}
        </span>
      ) : null}
      {children}
    </div>
  );
}
