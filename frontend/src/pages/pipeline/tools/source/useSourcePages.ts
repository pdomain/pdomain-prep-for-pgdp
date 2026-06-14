/**
 * useSourcePages — TanStack Query hook to load the page list for the
 * Source stage tool.
 *
 * Fetches `GET /api/data/projects/{projectId}/pages?limit=<n>` with
 * cursor-based pagination and maps the `PageRecord` response into
 * `FileRow[]` so `SourceFiles` can render real thumbnails.
 *
 * ## Thumbnail URL
 * Thumbnails are served at the ingest-thumbnail route:
 *   `GET /api/data/projects/{id}/pages/{idx0}/thumbnail`
 *
 * This route works at Source time, immediately after the ingest/source stage
 * runs — no processing stage needs to have completed. It returns 404 until
 * the ingest thumbnail has been generated; `RealThumb`'s `onError` handler
 * falls back to a paper placeholder in that case.
 *
 * NOTE: The previous implementation used the grayscale stage thumbnail route
 * (`/stages/grayscale/thumbnail`) which 404s before the grayscale stage runs,
 * making thumbnails unavailable at Source time. The ingest-thumbnail route is
 * the correct choice here.
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
 * Build the ingest-thumbnail URL for a page.
 *
 * Route: GET /api/data/projects/{id}/pages/{idx0}/thumbnail
 *
 * This route serves the page's ingest-time JPEG thumbnail, which is available
 * immediately after the source/ingest stage runs — no downstream pipeline stage
 * needs to be clean. Returns 404 if the thumbnail has not yet been generated
 * (still running), which `RealThumb` handles gracefully via its `onError` fallback.
 *
 * Use this instead of a stage thumbnail URL for Source-time display: the
 * grayscale stage thumbnail (`/stages/grayscale/thumbnail`) 404s before grayscale runs.
 */
export function ingestThumbUrl(projectId: string, idx0: number): string {
  return `/api/data/projects/${encodeURIComponent(projectId)}/pages/${String(idx0)}/thumbnail`;
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
        // Use the ingest-thumbnail route — works at Source time before any
        // pipeline stage runs. Falls back to FakePaperThumb on 404 (still generating).
        thumbnailKey: ingestThumbUrl(projectId, p.idx0),
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
