/**
 * useSourcePages — TanStack Query hook to load the page list for the
 * Source stage tool.
 *
 * Fetches `GET /api/data/projects/{projectId}/pages?limit=<n>` and maps
 * the `PageRecord` response into `FileRow[]` so `SourceFiles` can render
 * real thumbnails.
 *
 * ## Thumbnail URL
 * `PageRecord.thumbnail_key` is served at `/cdn/<thumbnail_key>`. The
 * `RealThumb` component handles the URL construction and fallback.
 *
 * ## Pagination
 * The backend supports `?limit=&cursor=` pagination. For the current local
 * use-case (< 1000 pages per project) we fetch all pages in one shot by
 * passing `limit=1000`. A future upgrade can add infinite-scroll via
 * `useInfiniteQuery`.
 *
 * ## State mapping
 * The backend `PageRecord` doesn't carry the Source-stage "role" state
 * (`cover`, `page`, `blank`, etc.) directly — those are set by the user in
 * this tool. Until the backend persists them:
 *  - `ignore: true`  → `"ready"` (user has marked it but we don't know role)
 *  - else            → `"ready"` (unmarked)
 *
 * Real state persistence is deferred (OPEN QUESTION Q-ST-1).
 *
 * @see frontend/src/api/types.gen.ts — PageRecord schema
 * @see frontend/src/pages/pipeline/tools/source/RealThumb.tsx
 */

import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/client";
import type { FileRow } from "@/machines/tools/source";

// ---------------------------------------------------------------------------
// Backend shape (from OpenAPI types.gen)
// ---------------------------------------------------------------------------

interface BackendPage {
  idx0: number;
  source_stem: string;
  thumbnail_key: string | null;
  /** true when the user has excluded this page */
  ignore: boolean;
  page_type: string;
}

interface ListPagesResponse {
  pages: BackendPage[];
  next_cursor: string | null;
}

// ---------------------------------------------------------------------------
// Fetch function
// ---------------------------------------------------------------------------

/**
 * Fetch all pages for a project.
 * Returns up to 1000 pages in one shot.
 */
async function fetchSourcePages(projectId: string): Promise<FileRow[]> {
  const data = await api.get<ListPagesResponse>(
    `/api/data/projects/${encodeURIComponent(projectId)}/pages?limit=1000`,
  );
  return data.pages.map((p): FileRow => {
    const row: FileRow = {
      idx: p.idx0,
      stem: p.source_stem,
      // "ready" = no role assigned yet. The machine can override via MARK_AS.
      state: "ready",
    };
    // Only set thumbnailKey when a real key exists (exactOptionalPropertyTypes).
    if (p.thumbnail_key) {
      row.thumbnailKey = p.thumbnail_key;
    }
    return row;
  });
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
    queryFn: () => fetchSourcePages(projectId),
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
