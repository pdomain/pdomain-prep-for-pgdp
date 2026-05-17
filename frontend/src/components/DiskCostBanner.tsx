/**
 * DiskCostBanner — shown in the project header when stage artifacts exist.
 *
 * Renders "Stage artifacts: X GB  /  ~Y GB estimated full DAG" with a
 * "Reclaim space" button (opens a "Coming soon" dialog — M4 placeholder).
 *
 * Hidden (no layout shift) when `stage_artifacts_bytes === 0`.
 * Spec: docs/specs/2026-05-13-m4-migration-disk-cost-design.md §Disk-cost banner
 */
import { HardDrive, X } from "lucide-react";
import { useState } from "react";
import type { components } from "../api/types.gen";

type Project = components["schemas"]["Project"];

const FULL_DAG_RATIO = 12;

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

interface DiskCostBannerProps {
  project: Pick<Project, "stage_artifacts_bytes" | "source_zip_bytes">;
}

export function DiskCostBanner({ project }: DiskCostBannerProps) {
  const [dialogOpen, setDialogOpen] = useState(false);

  const { stage_artifacts_bytes, source_zip_bytes } = project;

  // Spec: "banner renders nothing when stage_artifacts_bytes === 0"
  if (stage_artifacts_bytes === 0) return null;

  const estimated = source_zip_bytes * FULL_DAG_RATIO;

  return (
    <>
      <div
        className="overflow-hidden rounded-lg border border-status-running/30 bg-status-running-bg shadow-sm"
        data-testid="disk-cost-banner"
      >
        <div className="flex items-center gap-3 border-l-4 border-status-running py-3 pl-4 pr-3">
          <HardDrive
            className="h-5 w-5 shrink-0 text-status-running"
            strokeWidth={2}
            aria-hidden
          />
          <div className="flex-1 min-w-0">
            <p className="text-sm text-ink-1">
              <span className="font-semibold">Stage artifacts:</span>{" "}
              {formatBytes(stage_artifacts_bytes)}
              {estimated > 0 && (
                <span className="text-ink-3">
                  {" "}
                  / ~{formatBytes(estimated)} estimated full DAG
                </span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => setDialogOpen(true)}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-border-2 text-xs font-medium text-ink-2 hover:bg-bg-raised transition-colors"
            >
              Reclaim space
            </button>
          </div>
        </div>
      </div>

      {dialogOpen && (
        // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions -- backdrop click-to-close; role=dialog is set; keyboard close handled by Escape elsewhere
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40"
          onClick={() => setDialogOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Reclaim space"
        >
          {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- stopPropagation on inner panel; keyboard events handled by outer dialog */}
          <div
            className="relative w-full max-w-md rounded-lg bg-white p-6 shadow-lg space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-lg font-semibold text-slate-900">
                Reclaim disk space
              </h2>
              <button
                type="button"
                onClick={() => setDialogOpen(false)}
                aria-label="Close"
                className="inline-flex items-center justify-center h-8 w-8 rounded-md text-slate-500 hover:bg-slate-100 transition-colors"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
            <p className="text-sm text-slate-600">
              Stage artifact pruning is coming soon. In a future release you
              will be able to remove intermediate stage files for completed
              pages while keeping source images and final proofing outputs.
            </p>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setDialogOpen(false)}
                className="rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
