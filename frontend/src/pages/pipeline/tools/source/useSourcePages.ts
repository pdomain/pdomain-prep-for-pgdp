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
 * Priority: `ignore=true` always → `"skipped"` (manual soft-remove wins).
 * Otherwise, `page_role` is checked first (wins for "back"/"duplicate"):
 *   page_role="back"      → "back"
 *   page_role="duplicate" → "duplicate"
 * Then `page_type` is reverse-mapped to `FileState`:
 *   normal  → "page"
 *   cover   → "cover"
 *   blank   → "blank"
 *   skip    → "skipped"  (plain skip with no sub-role)
 *   other   → "ready"    (safe default for unknown/future types)
 *
 * @see frontend/src/api/types.gen.ts — PageRecord schema
 * @see frontend/src/pages/pipeline/tools/source/RealThumb.tsx
 */

import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/client";
import type { FileRow, FileState } from "@/machines/tools/source";

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
  /**
   * Optional sub-role label from PageRecord.page_role.
   * "back" or "duplicate" when set; null/undefined otherwise.
   * Takes precedence over page_type in resolveFileState when present.
   */
  page_role?: string | null;
}

export interface ListPagesResponse {
  pages: BackendPage[];
  next_cursor: string | null;
  total: number;
}

// ---------------------------------------------------------------------------
// Reverse PageType / page_role → FileState map
// ---------------------------------------------------------------------------

/**
 * Maps backend PageType values back to frontend FileState on load.
 *
 * Backend PageType enum (models.py): normal | blank | plate_b | plate_p |
 *   plate_r | skip | cover
 *
 * Mapping decisions:
 *   normal → "page"     (body page)
 *   cover  → "cover"    (front cover / endpapers)
 *   blank  → "blank"    (blank scan)
 *   skip   → "skipped"  (plain excluded page — no sub-role set)
 *
 * Unknown/future types fall through to "ready" (safe default).
 *
 * Priority:
 *   1. ignore=true → always "skipped" (manual soft-remove wins all)
 *   2. page_role="back"      → "back"      (durable sub-role)
 *   3. page_role="duplicate" → "duplicate" (durable sub-role)
 *   4. PAGE_TYPE_TO_FILE_STATE[page_type]  (normal, blank, cover, skip)
 *   5. "ready"               (safe default)
 */
const PAGE_TYPE_TO_FILE_STATE: Record<string, FileState> = {
  normal: "page",
  cover: "cover",
  blank: "blank",
  skip: "skipped",
};

/**
 * Valid page_role sub-labels that map back to a distinct FileState.
 * Both roles persist as page_type="skip" on the backend, but are
 * distinguished by page_role so the UI chip survives reload.
 */
const PAGE_ROLE_TO_FILE_STATE: Record<string, FileState> = {
  back: "back",
  duplicate: "duplicate",
};

/**
 * Resolve a loaded page's FileState from its persisted fields.
 *
 * Rule:
 *   1. ignore=true → "skipped" (always wins)
 *   2. page_role ("back"/"duplicate") → "back"/"duplicate" (durable sub-role)
 *   3. PAGE_TYPE_TO_FILE_STATE[page_type] → "page"/"cover"/"blank"/"skipped"
 *   4. "ready" (safe default)
 *
 * Exported so that other load paths (e.g. the insert-page refresh in
 * sourceTool.ts) can apply the same mapping and stay in sync.
 */
export function resolveFileState(
  ignore: boolean,
  page_type: string,
  page_role?: string | null,
): FileState {
  if (ignore) return "skipped";
  if (page_role != null && page_role !== "") {
    const roleState = PAGE_ROLE_TO_FILE_STATE[page_role];
    if (roleState !== undefined) return roleState;
  }
  return PAGE_TYPE_TO_FILE_STATE[page_type] ?? "ready";
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
        // Resolve state from persisted fields.
        // Priority: ignore=true → "skipped" (manual soft-remove wins);
        // then page_role ("back"/"duplicate") → distinct role chip;
        // then page_type reverse-map (normal→page, cover, blank, skip→skipped).
        // Unknown types → "ready".
        state: resolveFileState(p.ignore, p.page_type, p.page_role),
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
