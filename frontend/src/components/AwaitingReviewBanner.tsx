/**
 * AwaitingReviewBanner — shown when a build_package job is parked in the
 * awaiting_review state (M5 hi-fi design, amber left-accent variant).
 *
 * Fetches review status from the project's review-status endpoint.  When a
 * parked job exists, renders a dismissible amber banner with:
 *   - Amber left-accent border (M5 hi-fi §ReviewBanner).
 *   - Alert triangle icon (lucide-react).
 *   - "{N} page(s) need review before the package can build."
 *   - "build_package is parked — resumes automatically when count reaches 0."
 *   - "Review next page →" primary CTA (links to /projects/{id}/review).
 *   - Dismiss (X) ghost button (client-only hide; banner re-shows on reload
 *     while the job is still parked).
 */
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, X } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import type { components } from "../api/types.gen";

type ReviewStatusResponse = components["schemas"]["ReviewStatusResponse"];

export function AwaitingReviewBanner({ projectId }: { projectId: string }) {
  const [dismissed, setDismissed] = useState(false);

  const status = useQuery({
    queryKey: ["review-status", projectId],
    queryFn: () =>
      api.get<ReviewStatusResponse>(
        `/api/data/projects/${projectId}/review-status`,
      ),
    refetchInterval: 1000,
  });

  if (
    dismissed ||
    !status.data ||
    status.data.awaiting_review_job_id === null
  ) {
    return null;
  }

  const { unreviewed_count } = status.data;
  const pageWord = unreviewed_count === 1 ? "page" : "pages";

  return (
    <div className="rounded-lg border border-slate-200 bg-white shadow-sm overflow-hidden">
      <div className="flex items-center gap-3 pl-4 pr-3 py-3 border-l-4 border-amber-500">
        <AlertTriangle
          className="h-5 w-5 shrink-0 text-amber-600"
          strokeWidth={2}
          aria-hidden
        />
        <div className="flex-1 min-w-0">
          <p className="text-sm text-slate-900">
            <span className="font-semibold">
              {unreviewed_count} {pageWord} need review
            </span>{" "}
            before the package can build.
          </p>
          <p className="text-xs text-slate-500 mt-0.5">
            <code className="font-mono">build_package</code> is parked — it will
            resume automatically when the count reaches&nbsp;0.
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Link
            to={`/projects/${projectId}/review`}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-slate-900 text-white text-xs font-medium hover:bg-slate-800 transition-colors"
          >
            Review next page
            <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            aria-label="Dismiss"
            className="inline-flex items-center justify-center h-8 w-8 rounded-md text-slate-500 hover:bg-slate-100 transition-colors"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </div>
    </div>
  );
}
