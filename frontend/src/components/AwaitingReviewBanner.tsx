import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import type { components } from "../api/types.gen";

type ReviewStatusResponse = components["schemas"]["ReviewStatusResponse"];

export function AwaitingReviewBanner({ projectId }: { projectId: string }) {
  const status = useQuery({
    queryKey: ["review-status", projectId],
    queryFn: () =>
      api.get<ReviewStatusResponse>(
        `/api/data/projects/${projectId}/review-status`,
      ),
    refetchInterval: 1000,
  });

  if (!status.data || status.data.awaiting_review_job_id === null) {
    return null;
  }

  const { unreviewed_count } = status.data;
  const pageWord = unreviewed_count === 1 ? "page" : "pages";

  return (
    <div className="rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <p className="font-medium">
        {unreviewed_count} {pageWord} awaiting review before package can build
      </p>
      <p className="mt-2">
        <Link
          to={`/projects/${projectId}/review`}
          className="underline hover:text-amber-700"
        >
          Review next page
        </Link>
      </p>
    </div>
  );
}
