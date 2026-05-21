/**
 * PageDrawer — right-rail context panel that slides open when a page row
 * is clicked in the Pages tab.
 *
 * Shows: page number, processing status, and an "Open in workbench" action.
 * All data comes from the PageRecord already fetched by the page list — no
 * additional API calls.
 */
import { X } from "@concavetrillion/pd-ui/icons";
import { useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { IconButton } from "@/components/ui/IconButton";
import { Separator } from "@/components/ui/Separator";
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

const PAGE_TYPE_LABELS: Record<
  components["schemas"]["PageType"],
  string | null
> = {
  normal: null,
  blank: "Blank",
  plate_b: "Plate (B)",
  plate_p: "Plate (P)",
  plate_r: "Plate (R)",
};

interface PageDrawerProps {
  page: PageRecord | null; // null = closed
  projectId: string;
  onClose: () => void;
  "data-testid"?: string;
}

export function PageDrawer({
  page,
  projectId,
  onClose,
  "data-testid": testId,
}: PageDrawerProps) {
  const navigate = useNavigate();

  if (!page) return null;

  const badgeStatus = STATUS_TO_BADGE[page.processing_status];
  const pageTypeLabel = PAGE_TYPE_LABELS[page.page_type];

  return (
    <aside
      data-testid={testId ?? "page-drawer"}
      className="w-[360px] border-l border-border-1 bg-bg-surface flex flex-col overflow-y-auto"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border-1">
        <span className="text-sm font-medium text-ink-1">
          Page {page.idx0 + 1}
        </span>
        <IconButton
          variant="ghost"
          onClick={onClose}
          aria-label="Close drawer"
          data-testid="page-drawer-close"
        >
          <X className="h-4 w-4" />
        </IconButton>
      </div>

      {/* Content */}
      <div className="flex flex-col gap-4 p-4">
        {/* Source info */}
        <div>
          <p className="text-xs font-medium text-ink-3 mb-1">Source</p>
          <p
            className="text-sm text-ink-1 font-mono truncate"
            title={page.source_stem}
          >
            {page.prefix || page.source_stem}
          </p>
        </div>

        {/* Status */}
        <div className="flex items-center gap-3">
          {badgeStatus && (
            <Badge
              status={badgeStatus}
              data-testid="page-drawer-status-badge"
            />
          )}
          {pageTypeLabel && (
            <span className="text-xs text-ink-3">{pageTypeLabel}</span>
          )}
          {page.ignore && (
            <span className="text-xs text-ink-3">Outside proof range</span>
          )}
        </div>

        {/* Error message if errored */}
        {page.processing_status === "error" && page.processing_error && (
          <div
            className={cn(
              "rounded-md bg-status-error-bg p-2 text-xs text-status-error",
            )}
          >
            {page.processing_error}
          </div>
        )}

        <Separator />

        {/* Actions */}
        <Button
          variant="primary"
          className="w-full"
          onClick={() => navigate(`/projects/${projectId}/pages/${page.idx0}`)}
          data-testid="page-drawer-open-workbench"
        >
          Open in workbench
        </Button>
      </div>
    </aside>
  );
}
