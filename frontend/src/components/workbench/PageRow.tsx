/**
 * PageRow — one row in the Pages tab page list.
 *
 * Displays: drag handle, page number, source stem, processing status badge,
 * and a right-chevron to indicate the row is clickable (opens PageDrawer).
 *
 * Supports HTML5 native drag-and-drop for page reordering when drag event
 * handlers are provided by the parent.
 */
import { ChevronRight } from "@concavetrillion/pd-ui/icons";
import { GripVertical } from "@/icons/local-shims";
import type { DragEventHandler } from "react";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/utils";
import type { components } from "@/api/types.gen";

type PageRecord = components["schemas"]["PageRecord"];
type PageProcessingStatus = components["schemas"]["PageProcessingStatus"];
type BadgeStatus = "running" | "complete" | "queued" | "error";

const STATUS_TO_BADGE: Record<PageProcessingStatus, BadgeStatus | null> = {
  pending: "queued",
  processing: "running",
  complete: "complete",
  error: "error",
};

interface PageRowProps {
  page: PageRecord;
  isSelected: boolean;
  onSelect: (idx0: number) => void;
  "data-testid"?: string;
  /** Drag-and-drop handlers supplied by the parent for page reordering. */
  draggable?: boolean;
  onDragStart?: DragEventHandler<HTMLDivElement>;
  onDragOver?: DragEventHandler<HTMLDivElement>;
  onDrop?: DragEventHandler<HTMLDivElement>;
  onDragEnd?: DragEventHandler<HTMLDivElement>;
}

export function PageRow({
  page,
  isSelected,
  onSelect,
  "data-testid": testId,
  draggable,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: PageRowProps) {
  const badgeStatus = STATUS_TO_BADGE[page.processing_status];

  return (
    <div
      data-testid={testId ?? `page-row-${page.idx0}`}
      role="button"
      tabIndex={0}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      onClick={() => onSelect(page.idx0)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(page.idx0);
        }
      }}
      className={cn(
        "flex items-center gap-3 rounded-md p-3 cursor-pointer transition-colors",
        "hover:bg-bg-raised border border-transparent",
        isSelected && "border-border-2 bg-bg-raised",
      )}
    >
      {/* Drag handle — always visible, signals reorderability */}
      <span
        data-testid="drag-handle"
        className="shrink-0 cursor-grab text-ink-4 active:cursor-grabbing"
        aria-hidden="true"
      >
        <GripVertical className="h-4 w-4" />
      </span>

      {/* Page number (1-indexed) */}
      <span className="w-10 shrink-0 text-right font-mono text-xs text-ink-3">
        {page.idx0 + 1}
      </span>

      {/* Source stem / filename */}
      <span className="flex-1 truncate text-sm text-ink-1">
        {page.prefix || page.source_stem}
      </span>

      {/* Status badge */}
      {badgeStatus && (
        <Badge
          status={badgeStatus}
          data-testid={`page-row-badge-${page.idx0}`}
        />
      )}

      {/* Chevron */}
      <ChevronRight className="ml-auto h-4 w-4 shrink-0 text-ink-4" />
    </div>
  );
}
