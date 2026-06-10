/**
 * Body — page-level content wrapper used inside pack-group stage tools.
 *
 * Provides the standard padded content area for archive, build_package,
 * proof_pack, zip, submit_check, and validation stage tools.
 *
 * Disposition: stays app-local (see docs/specs/library-placement.md §1.3).
 * PGDP-specific layout; different from pdomain-ui's generic AppShell main slot.
 *
 * Token-only styling; no hex literals.
 */
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface BodyProps {
  children?: ReactNode;
  className?: string;
  "data-testid"?: string;
  "data-screen-label"?: string;
}

export function Body({
  children,
  className,
  "data-testid": testId,
  "data-screen-label": screenLabel,
}: BodyProps) {
  return (
    <div
      data-testid={testId ?? "stage-body"}
      data-screen-label={screenLabel}
      className={cn(
        "flex flex-col gap-4 p-6 min-h-0 flex-1 overflow-auto bg-bg-page",
        className,
      )}
    >
      {children}
    </div>
  );
}
