// TODO(s0-b): replace with pd-ui Badge when pd-ui exports a domain status variant.
// pd-ui Badge uses variant: "default"|"primary"|"danger" + tone prop (generic).
// This component uses a domain-specific status prop ("running", "complete", etc.)
// with colour semantics tied to PGDP pipeline states. Cannot be swapped without
// either migrating all callers to pd-ui's generic API or pd-ui adding status awareness.

/**
 * Badge — lightweight status indicator (M5 hi-fi adoption).
 *
 * No Radix primitive underlies this one — a badge is purely presentational.
 * The component encodes the status → colour map from the M5 hi-fi design file
 * so callers never scatter Tailwind colour classes for status semantics.
 *
 * Usage:
 *   <Badge status="running" />       → "Running" with blue dot
 *   <Badge status="complete" />      → "Done" with emerald dot
 *   <Badge status="error" />         → "Errored" with red dot
 *   <Badge status="queued" />        → "Queued" with slate dot
 *   <Badge status="awaiting_review" /> → "Review" with amber dot
 *
 * `children` overrides the default label when provided.
 */
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type BadgeStatus =
  | "running"
  | "complete"
  | "queued"
  | "scheduled"
  | "error"
  | "cancelled"
  | "awaiting_review";

interface StatusMeta {
  label: string;
  /** ring + text + background classes */
  cls: string;
  /** dot background class */
  dot: string;
}

const STATUS_META: Record<BadgeStatus, StatusMeta> = {
  running: {
    label: "Running",
    cls: "bg-status-running-bg text-status-running ring-status-running/20",
    dot: "bg-status-running",
  },
  complete: {
    label: "Done",
    cls: "bg-status-done-bg text-status-done ring-status-done/20",
    dot: "bg-status-done",
  },
  queued: {
    label: "Queued",
    cls: "bg-status-queued-bg text-status-queued ring-status-queued/20",
    dot: "bg-status-queued",
  },
  scheduled: {
    label: "Scheduled",
    cls: "bg-status-queued-bg text-status-queued ring-status-queued/20",
    dot: "bg-status-queued",
  },
  error: {
    label: "Errored",
    cls: "bg-status-error-bg text-status-error ring-status-error/20",
    dot: "bg-status-error",
  },
  cancelled: {
    label: "Cancelled",
    cls: "bg-status-queued-bg text-ink-3 ring-border-1/20",
    dot: "bg-status-queued",
  },
  awaiting_review: {
    label: "Review",
    cls: "bg-status-review-bg text-status-review ring-status-review/20",
    dot: "bg-status-review",
  },
};

export interface BadgeProps {
  status: BadgeStatus;
  children?: ReactNode;
  className?: string;
  "data-testid"?: string;
}

export function Badge({
  status,
  children,
  className = "",
  "data-testid": testId,
}: BadgeProps) {
  const meta = STATUS_META[status];
  return (
    <span
      data-testid={testId}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
        meta.cls,
        className,
      )}
    >
      <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full", meta.dot)} />
      {children ?? meta.label}
    </span>
  );
}
