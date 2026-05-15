/**
 * CropsGridPage — /projects/:projectId/crops
 *
 * Shows canvas_map stage thumbnails for every page in a project arranged in a
 * responsive grid. Each card links to that page's workbench so users can quickly
 * spot crop / alignment problems before running OCR.
 */

import { useInfiniteQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api/client";
import type { components } from "../api/types.gen";

type PageRecord = components["schemas"]["PageRecord"];
type ListPagesResponse = components["schemas"]["ListPagesResponse"];

/** Thumbnail URL for the canvas_map stage of a given page. */
function canvasMapThumbnailUrl(projectId: string, idx0: number): string {
  return `/api/data/projects/${projectId}/pages/${idx0}/stages/canvas_map/thumbnail`;
}

export function CropsGridPage() {
  const { projectId = "" } = useParams();

  const pages = useInfiniteQuery({
    queryKey: ["pages", projectId],
    queryFn: ({ pageParam }) =>
      api.get<ListPagesResponse>(
        `/api/data/projects/${projectId}/pages?limit=200` +
          (pageParam ? `&cursor=${encodeURIComponent(String(pageParam))}` : ""),
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  });

  const allPages = useMemo(
    () => (pages.data?.pages ?? []).flatMap((p) => p.pages),
    [pages.data],
  );

  if (pages.isLoading) {
    return <p className="text-slate-500">Loading…</p>;
  }

  return (
    <section className="space-y-4">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-slate-500">
        <Link
          to={`/projects/${projectId}`}
          className="hover:text-slate-800 underline"
        >
          Back to project
        </Link>
        <span aria-hidden>/</span>
        <span className="text-slate-800 font-medium">Crops</span>
      </nav>

      <h1 className="text-xl font-semibold">Crop thumbnails</h1>

      {allPages.length === 0 ? (
        <p className="text-slate-500">No pages yet.</p>
      ) : (
        <div className="grid gap-3 grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
          {allPages.map((page: PageRecord) => (
            <ThumbnailCard key={page.idx0} page={page} projectId={projectId} />
          ))}
        </div>
      )}
    </section>
  );
}

function ThumbnailCard({
  page,
  projectId,
}: {
  page: PageRecord;
  projectId: string;
}) {
  const href = `/projects/${projectId}/pages/${page.idx0}`;

  return (
    <Link
      to={href}
      className="group flex flex-col items-center gap-1 rounded border border-slate-200 bg-white p-1.5 hover:border-slate-400 hover:shadow-sm transition-all"
    >
      {page.thumbnail_key !== null ? (
        <img
          src={canvasMapThumbnailUrl(projectId, page.idx0)}
          alt={page.prefix}
          className="w-full rounded object-contain aspect-[3/4] bg-slate-50"
        />
      ) : (
        <div
          data-testid={`thumbnail-placeholder-${page.idx0}`}
          className="w-full rounded bg-slate-100 aspect-[3/4] flex items-center justify-center text-xs text-slate-400"
        >
          no crop
        </div>
      )}
      <span className="text-[11px] font-mono text-slate-600 truncate w-full text-center leading-tight">
        {page.prefix}
      </span>
    </Link>
  );
}
