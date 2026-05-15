import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { useEffect } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api/client";
import type { components } from "../api/types.gen";
import { useActiveBatchJob } from "../hooks/useActiveBatchJob";
import { PageHeader } from "../components/shell/PageHeader";
import { Card } from "../components/ui/Card";
import { Badge } from "../components/ui/Badge";
import type { BadgeStatus } from "../components/ui/Badge";
import { buttonVariants } from "../components/ui/Button";
import { cn } from "../lib/utils";

type PageRecord = components["schemas"]["PageRecord"];
type ListPagesResponse = components["schemas"]["ListPagesResponse"];
type PageProcessingStatus = components["schemas"]["PageProcessingStatus"];

/** Map page processing status to a Badge status token. */
function pageStatusToBadge(status: PageProcessingStatus): BadgeStatus {
  switch (status) {
    case "complete":
      return "complete";
    case "error":
      return "error";
    case "processing":
      return "running";
    case "pending":
    default:
      return "queued";
  }
}

/** Non-dismissable amber info banner shown at the top of the review queue. */
function ReviewQueueBanner({ total }: { total: number }) {
  return (
    <div className="overflow-hidden rounded-lg border border-status-review/30 bg-status-review-bg shadow-sm">
      <div className="flex items-center gap-3 border-l-4 border-status-review py-3 pl-4 pr-3">
        <AlertTriangle
          className="h-5 w-5 shrink-0 text-status-review"
          strokeWidth={2}
          aria-hidden
        />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-ink-1">
            Review queue — {total} {total === 1 ? "page" : "pages"} needing
            attention
          </p>
          <p className="text-xs text-ink-3 mt-0.5">
            Reviewing all {total} pages before the package builds.
          </p>
        </div>
      </div>
    </div>
  );
}

export function ProjectReviewQueuePage() {
  const { projectId = "" } = useParams();
  const queryClient = useQueryClient();
  const queue = useQuery({
    queryKey: ["review-queue", projectId],
    queryFn: () =>
      api.get<ListPagesResponse>(
        `/api/data/projects/${projectId}/pages?review_needed=true&limit=500`,
      ),
  });
  // Surface a small "batch running" badge in the header so reviewers know
  // the queue may still be growing/shrinking under them. Also refresh the
  // queue when a batch starts/stops so they don't have to reload manually.
  const activeBatch = useActiveBatchJob(projectId || null);
  useEffect(() => {
    queryClient.invalidateQueries({ queryKey: ["review-queue", projectId] });
  }, [activeBatch.jobId, queryClient, projectId]);

  if (queue.isLoading) return <p className="text-ink-3">Loading…</p>;
  if (!queue.data)
    return <p className="text-status-error">Project not found.</p>;

  const batchActions = activeBatch.jobId ? (
    <span
      className="inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium
        bg-status-running-bg text-status-running ring-1 ring-status-running/20 animate-pulse"
      title={`A ${activeBatch.status} batch_process_pages job is running on this project`}
    >
      <span
        aria-hidden
        className="h-1.5 w-1.5 rounded-full bg-status-running"
      />
      Batch running
    </span>
  ) : null;

  return (
    <section className="space-y-4">
      <PageHeader
        title="Review queue"
        description={`${queue.data.total} ${queue.data.total === 1 ? "page" : "pages"} need review`}
        actions={
          <>
            {batchActions}
            <Link
              to={`/projects/${projectId}`}
              className={cn(
                buttonVariants({ variant: "secondary", size: "sm" }),
              )}
            >
              ← Back to project
            </Link>
          </>
        }
      />

      {queue.data.pages.length > 0 && (
        <ReviewQueueBanner total={queue.data.pages.length} />
      )}

      {queue.data.pages.length === 0 ? (
        <p
          data-testid="empty-state"
          className="rounded border border-dashed border-border-2 bg-bg-surface p-6 text-center text-ink-3"
        >
          Nothing to review — every page is complete.
        </p>
      ) : (
        <ul className="space-y-2">
          {queue.data.pages.map((p: PageRecord) => (
            <li key={p.idx0}>
              <Card className="flex items-center justify-between gap-4 px-4 py-3">
                <div className="flex items-center gap-3 min-w-0">
                  {p.thumbnail_key && (
                    <img
                      src={`/cdn/${p.thumbnail_key}`}
                      alt=""
                      className="h-12 w-8 rounded object-cover shrink-0"
                      loading="lazy"
                    />
                  )}
                  <div className="min-w-0">
                    <div className="font-mono text-sm text-ink-1 truncate">
                      {p.prefix || `#${p.idx0}`}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-ink-3 mt-0.5">
                      <Badge status={pageStatusToBadge(p.processing_status)} />
                      {p.processing_error && (
                        <span className="text-status-error truncate">
                          {p.processing_error}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <Link
                  to={`/projects/${projectId}/pages/${p.idx0}/review`}
                  className={cn(
                    buttonVariants({ variant: "secondary", size: "sm" }),
                  )}
                >
                  Review →
                </Link>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
