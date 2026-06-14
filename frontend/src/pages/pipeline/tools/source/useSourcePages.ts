/**
 * useSourcePages — TanStack Query hook to load the page list for the
 * Source stage tool.
 *
 * Fetches `GET /api/data/projects/{projectId}/pages?limit=<n>` with
 * cursor-based pagination and maps the `PageRecord` response into
 * `FileRow[]` so `SourceFiles` can render real thumbnails.
 *
 * ## Thumbnail URL
 * `PageRecord.thumbnail_key` is always null (ingest_source is not a v2
 * page stage). Real thumbnails are served at
 * `/api/data/projects/{id}/pages/{idx0}/stages/grayscale/thumbnail`
 * when the grayscale stage is clean. The `stageThumbUrl` helper builds
 * this URL; `RealThumb` handles the URL and falls back to `FakePaperThumb`
 * on 404.
 *
 * ## Pagination
 * The backend caps `limit` at 500. For projects >500 pages we follow the
 * `next_cursor` in a loop so all pages load.
 *
 * ## State mapping
 * `ignore: true` maps to FileState `"skipped"` (reversible via PATCH).
 * All other pages map to `"ready"`.
 *
 * @see frontend/src/api/types.gen.ts — PageRecord schema
 * @see frontend/src/pages/pipeline/tools/source/RealThumb.tsx
 */

import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/client";
import type { FileRow } from "@/machines/tools/source";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum pages per request (backend cap). */
const PAGE_LIMIT = 500;

// ---------------------------------------------------------------------------
// Backend shape (from OpenAPI types.gen)
// ---------------------------------------------------------------------------

interface BackendPage {
  idx0: number;
  source_stem: string;
  /** Always null — ingest_source is not a v2 page stage. */
  thumbnail_key: string | null;
  /** true when the user has excluded this page */
  ignore: boolean;
  page_type: string;
}

export interface ListPagesResponse {
  pages: BackendPage[];
  next_cursor: string | null;
  total: number;
}

// ---------------------------------------------------------------------------
// Thumbnail URL helper
// ---------------------------------------------------------------------------

/**
 * Build the per-page stage thumbnail URL.
 * Uses the grayscale stage (first v2 stage with a thumbnail in the local
 * pipeline) as the source image for the Source tool grid.
 *
 * Returns null when projectId or idx0 is not available.
 */
export function stageThumbUrl(
  projectId: string,
  idx0: number,
  stageId = "grayscale",
): string {
  return `/api/data/projects/${encodeURIComponent(projectId)}/pages/${String(idx0)}/stages/${encodeURIComponent(stageId)}/thumbnail`;
}

// ---------------------------------------------------------------------------
// Fetch function
// ---------------------------------------------------------------------------

/**
 * Fetch all pages for a project via cursor-based pagination.
 * Follows next_cursor until all pages are loaded.
 */
export async function fetchAllSourcePages(
  projectId: string,
): Promise<FileRow[]> {
  const rows: FileRow[] = [];
  let cursor: string | null = null;

  do {
    const url: string = cursor
      ? `/api/data/projects/${encodeURIComponent(projectId)}/pages?limit=${String(PAGE_LIMIT)}&cursor=${encodeURIComponent(cursor)}`
      : `/api/data/projects/${encodeURIComponent(projectId)}/pages?limit=${String(PAGE_LIMIT)}`;

    const data: ListPagesResponse = await api.get<ListPagesResponse>(url);

    for (const p of data.pages) {
      const row: FileRow = {
        idx: p.idx0,
        stem: p.source_stem,
        // ignore=true → "skipped" so the machine can filter+restore
        state: p.ignore ? "skipped" : "ready",
        // Wire real stage thumbnail URL instead of the always-null thumbnail_key
        thumbnailKey: stageThumbUrl(projectId, p.idx0),
      };
      rows.push(row);
    }

    cursor = data.next_cursor;
  } while (cursor !== null);

  return rows;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface UseSourcePagesResult {
  files: FileRow[];
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => void;
}

/**
 * Fetch the page list for the Source stage.
 *
 * Returns the list as `FileRow[]` suitable for seeding the sourceToolMachine.
 * Falls back to an empty array on error (the machine can show an error state).
 *
 * @param projectId  The current project UUID.
 * @param enabled    Set false to suspend fetching (e.g. no projectId yet).
 */
export function useSourcePages(
  projectId: string,
  enabled = true,
): UseSourcePagesResult {
  const query = useQuery({
    queryKey: ["sourcePages", projectId],
    queryFn: () => fetchAllSourcePages(projectId),
    enabled: enabled && Boolean(projectId),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  return {
    files: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error instanceof Error ? query.error : null,
    refetch: () => void query.refetch(),
  };
}
